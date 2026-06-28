// PluginExport.h
// =====================================================================
//  "Export as Plugin" — turn the currently loaded creation into a standalone,
//  locked whitelabel .vst3 the user can hand to others.
//
//  The mechanism is deliberately a *copy*, not a rebuild (see the plan): the
//  running plugin bundle is duplicated faithfully (binary byte-identical), the
//  current creation is baked into the copy's Resources as `baked.vstai` with the
//  lock flag set, and the copy is re-sealed with the same signing identity so it
//  "keeps the sign". At load time the plugin detects the baked file and opens
//  straight into the product GUI (LockedEditor) with no authoring chrome.
//
//  NOTE on identity: a VST3's class id + plugin-list name are compiled into the
//  binary, so a copy reuses VibePlugin's identity. This is fine for handing one
//  whitelabel product to someone who doesn't also run VibePlugin; two copies (or
//  copy + original) on one machine can collide. True coexistence needs a rebuild.
// =====================================================================

#pragma once

#include <juce_core/juce_core.h>
#include <functional>
#include "VstaiDocument.h"

namespace vstai::pluginexport
{
    inline constexpr const char* kBakedDocName = "baked.vstai";

    // --- locating the running bundle / its baked creation --------------------

    // The .vst3 bundle this binary lives in (the nearest ancestor dir named
    // "*.vst3"), or an invalid File if not found (e.g. the Standalone build).
    inline juce::File findOwnBundle()
    {
        auto f = juce::File::getSpecialLocation (juce::File::currentExecutableFile);
        for (int i = 0; i < 6 && f.exists(); ++i)
        {
            if (f.isDirectory() && f.getFileName().endsWithIgnoreCase (".vst3"))
                return f;
            f = f.getParentDirectory();
        }
        return {};
    }

    // The baked creation shipped inside this bundle, if any. `VSTAI_BAKED_DOC`
    // points at a .vstai for dev testing without packaging.
    inline juce::File bakedDocFile()
    {
        const auto env = juce::SystemStats::getEnvironmentVariable ("VSTAI_BAKED_DOC", {});
        if (env.isNotEmpty())
        {
            auto f = juce::File::getCurrentWorkingDirectory().getChildFile (env);
            return f.existsAsFile() ? f : juce::File();
        }

        auto exe = juce::File::getSpecialLocation (juce::File::currentExecutableFile);
        for (auto base : { exe.getParentDirectory().getChildFile ("Resources"),
                           exe.getParentDirectory().getParentDirectory().getChildFile ("Resources") })
        {
            auto f = base.getChildFile (kBakedDocName);
            if (f.existsAsFile()) return f;
        }
        return {};
    }

    // Dev override: open the normal (non-baked) plugin in locked mode anyway, so
    // the product view can be tested without exporting. Set VSTAI_FORCE_LOCKED=1.
    inline bool forceLocked()
    {
        auto v = juce::SystemStats::getEnvironmentVariable ("VSTAI_FORCE_LOCKED", {}).trim();
        return v.isNotEmpty() && v != "0" && ! v.equalsIgnoreCase ("false");
    }

    // --- process helpers -----------------------------------------------------

    // Run argv (no shell) and collect output; true on exit 0.
    inline bool runProcess (const juce::StringArray& argv, juce::String& out)
    {
        juce::ChildProcess p;
        if (! p.start (argv)) { out = "could not launch " + argv[0]; return false; }
        out = p.readAllProcessOutput();
        return p.getExitCode() == 0;
    }

    // The codesigning identity to re-seal with, mirroring scripts/common.sh:
    // VSTAI_SIGN_ID override, else a "Developer ID Application" cert, else the
    // first codesigning identity, else "-" (ad-hoc, loads on this Mac only).
    inline juce::String pickSigningIdentity()
    {
        const auto env = juce::SystemStats::getEnvironmentVariable ("VSTAI_SIGN_ID", {}).trim();
        if (env.isNotEmpty()) return env;

        juce::String out;
        if (runProcess ({ "security", "find-identity", "-v", "-p", "codesigning" }, out))
        {
            const auto lines = juce::StringArray::fromLines (out);
            auto quoted = [] (const juce::String& l)
            {
                return l.fromFirstOccurrenceOf ("\"", false, false)
                        .upToLastOccurrenceOf ("\"", false, false);
            };
            for (auto& l : lines)
                if (l.contains ("Developer ID Application") && l.contains ("\""))
                    return quoted (l);
            for (auto& l : lines)
                if (l.contains ("\""))
                    return quoted (l);
        }
        return "-";
    }

    // Copy a bundle faithfully — modes, symlinks, nested signatures intact.
    // JUCE's copyDirectoryTo drops the executable bit, which breaks the plugin,
    // so use ditto / cp -a on the platforms that have them.
    inline bool copyBundle (const juce::File& src, const juce::File& dest, juce::String& errOut)
    {
       #if JUCE_MAC
        if (runProcess ({ "ditto", src.getFullPathName(), dest.getFullPathName() }, errOut)) return true;
        errOut = "ditto failed: " + errOut; return false;
       #elif JUCE_LINUX
        if (runProcess ({ "cp", "-a", src.getFullPathName(), dest.getFullPathName() }, errOut)) return true;
        errOut = "cp -a failed: " + errOut; return false;
       #else
        if (src.copyDirectoryTo (dest)) return true;
        errOut = "could not copy the plugin bundle"; return false;
       #endif
    }

    // Cosmetic: surface the product name in the copy's Info.plist. Best effort —
    // the plugin-list name is fixed by the compiled binary regardless.
    inline void setBundleDisplayName (const juce::File& bundle, const juce::String& name)
    {
       #if JUCE_MAC
        auto plist = bundle.getChildFile ("Contents").getChildFile ("Info.plist");
        if (! plist.existsAsFile() || name.isEmpty()) return;
        juce::String out;
        for (auto* key : { "CFBundleName", "CFBundleDisplayName" })
        {
            const juce::String set = juce::String ("Set :")  + key + " " + name;
            const juce::String add = juce::String ("Add :")  + key + " string " + name;
            if (! runProcess ({ "/usr/libexec/PlistBuddy", "-c", set, plist.getFullPathName() }, out))
                runProcess ({ "/usr/libexec/PlistBuddy", "-c", add, plist.getFullPathName() }, out);
        }
       #else
        juce::ignoreUnused (bundle, name);
       #endif
    }

    // Slim a locked export down to what the product actually runs. The DSP engine
    // (wasmtime) is linked into the binary and plays the baked WASM directly, and the
    // GUI is served from the baked doc — so the bundled AssemblyScript compiler
    // (vstai-node ~113 MB of JIT'ing JS runtime + asc-bundle.mjs) and the WebView
    // authoring shell (Resources/ui — Monaco etc.) are never touched in locked mode.
    // Dropping them shrinks each export by ~100+ MB and removes a second JIT binary
    // that would otherwise need entitling/notarizing later.
    inline void stripUnusedForLocked (const juce::File& bundle)
    {
        auto res = bundle.getChildFile ("Contents").getChildFile ("Resources");
        res.getChildFile ("vstai-node").deleteFile();
        res.getChildFile ("asc-bundle.mjs").deleteFile();
        res.getChildFile ("ui").deleteRecursively();
    }

    // JIT entitlements: the locked product's DSP engine (wasmtime) compiles the baked
    // WASM to native code at load, which hardened runtime blocks unless we allow it.
    // Hardened runtime is required for notarization, so every export needs these.
    inline juce::File writeJitEntitlements()
    {
        auto f = juce::File::getSpecialLocation (juce::File::tempDirectory)
                     .getChildFile ("vstai-export-jit.entitlements");
        f.replaceWithText (
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n"
            "<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n"
            "<plist version=\"1.0\"><dict>\n"
            "  <key>com.apple.security.cs.allow-jit</key><true/>\n"
            "  <key>com.apple.security.cs.allow-unsigned-executable-memory</key><true/>\n"
            "</dict></plist>\n");
        return f;
    }

    // Sign the export for distribution: Developer ID + hardened runtime (which
    // notarization requires) + the JIT entitlements. A secure (network) timestamp is
    // mandatory for notarization, so request it only then — otherwise sign offline.
    // (vstai-node was stripped, so the bundle's main binary is the only Mach-O. The
    //  JIT entitlements don't bind to a bundle Mach-O and don't need to: a loaded
    //  plugin JITs under the *host's* entitlements, which real DAWs already carry.)
    inline bool signForExport (const juce::File& bundle, bool secureTimestamp, juce::String& errOut)
    {
       #if JUCE_MAC
        const auto id  = pickSigningIdentity();
        const auto ent = writeJitEntitlements();
        juce::String out;
        const juce::StringArray args { "codesign", "--force", "--options", "runtime",
                                       "--entitlements", ent.getFullPathName(),
                                       (secureTimestamp ? "--timestamp" : "--timestamp=none"),
                                       "-s", id, bundle.getFullPathName() };
        if (! runProcess (args, out))
        {
            errOut = "codesign failed: " + out;
            return false;
        }
        if (! runProcess ({ "codesign", "--verify", "--strict", bundle.getFullPathName() }, out))
        {
            errOut = "signed but verification failed: " + out;
            return false;
        }
        return true;
       #else
        juce::ignoreUnused (bundle, secureTimestamp);
        errOut.clear();
        return true;
       #endif
    }

    // Submit the signed bundle to Apple's notary service and staple the ticket, so it
    // loads with no Gatekeeper prompt on any Mac. Uses a notarytool keychain profile
    // (one-time: `xcrun notarytool store-credentials <profile> --apple-id … --team-id …
    // --password <app-specific>`). Blocking (minutes) — callers run it off-thread.
    inline bool notarize (const juce::File& bundle, const juce::String& profile,
                          const std::function<void(const juce::String&)>& progress, juce::String& errOut)
    {
       #if JUCE_MAC
        if (profile.isEmpty()) { errOut = "no notary profile set"; return false; }

        auto zip = juce::File::getSpecialLocation (juce::File::tempDirectory)
                       .getChildFile (bundle.getFileNameWithoutExtension() + "-notarize.zip");
        zip.deleteFile();
        juce::String out;
        if (! runProcess ({ "ditto", "-c", "-k", "--keepParent", bundle.getFullPathName(), zip.getFullPathName() }, out))
        { errOut = "could not zip for notarization: " + out; return false; }

        if (progress) progress ("Notarizing with Apple — this can take a few minutes…");
        runProcess ({ "xcrun", "notarytool", "submit", zip.getFullPathName(),
                      "--keychain-profile", profile, "--wait", "--timeout", "20m" }, out);
        zip.deleteFile();

        if (! out.contains ("status: Accepted"))
        {
            errOut = out.containsIgnoreCase ("could not find") || out.containsIgnoreCase ("no keychain")
                ? ("notary profile \"" + profile + "\" not set up — run: xcrun notarytool store-credentials "
                   + profile + " --apple-id <you> --team-id 8P7SXGP62N --password <app-specific>")
                : ("Apple did not accept it — `xcrun notarytool log` for details. " + out.substring (0, 300));
            return false;
        }

        if (progress) progress ("Stapling the notarization ticket…");
        if (! runProcess ({ "xcrun", "stapler", "staple", bundle.getFullPathName() }, out))
        { errOut = "notarized but stapling failed: " + out; return false; }
        return true;
       #else
        juce::ignoreUnused (bundle, profile, progress);
        errOut.clear();
        return true;
       #endif
    }

    // --- distinct VST3 identity (so an export is a real *new* plugin) ---------
    //
    // A VST3's class ids (CIDs) + list name are compiled into the binary, so a
    // plain copy reuses VibePlugin's identity and collides with it (and with other
    // exports). We re-identify the copy by patching the binary IN PLACE — only
    // same-length byte rewrites, so the Mach-O stays structurally valid and is then
    // re-signed. JUCE builds each CID as
    //     ABCDEF01 <per-class> <"Vsai" manufacturer> <"Vssy"/"Vsfx" plugin code>
    // and the manufacturer+plugin code is the LAST 8 bytes (the GUID "Data4" array,
    // which is never byte-swapped on any platform), so rewriting the 4-byte plugin
    // code there gives a unique, deterministic id without touching anything fragile.

    inline juce::String fourCharHex (const juce::String& s)   // 4 ascii bytes -> 8 upper-hex
    {
        juce::String h; auto* p = s.toRawUTF8();
        for (int i = 0; i < (int) s.getNumBytesAsUTF8(); ++i)
            h += juce::String::toHexString ((int) (juce::uint8) p[i]).paddedLeft ('0', 2).toUpperCase();
        return h;
    }

    // A stable 4-char plugin code derived from the product name (same name -> same
    // id, so re-exporting updates a product cleanly). Never equals the source code.
    inline juce::String derivePluginCode (const juce::String& productName, const juce::String& avoid)
    {
        static const char* a = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
        const auto base = (juce::uint64) (juce::int64) productName.hashCode64();
        for (int attempt = 0; attempt < 16; ++attempt)
        {
            juce::uint64 x = base + (juce::uint64) attempt * 0x9E3779B97F4A7C15ULL;
            char buf[5] = { 0, 0, 0, 0, 0 };
            for (int i = 0; i < 4; ++i) { buf[i] = a[(int) (x % 62)]; x /= 62; }
            juce::String c (buf);
            if (c != avoid) return c;
        }
        return "Xpt1";
    }

    // Product name reduced to a safe, <= maxBytes label for the binary/moduleinfo.
    inline juce::String sanitizeName (const juce::String& name, int maxBytes)
    {
        juce::String out;
        for (int i = 0; i < name.length(); ++i)
        {
            auto c = name[i];
            if (juce::CharacterFunctions::isLetterOrDigit (c)
                || c == ' ' || c == '-' || c == '_' || c == '.' || c == '+' || c == '&')
                out += juce::String::charToString (c);
        }
        out = out.trim();
        if (out.isEmpty()) out = "Plugin";
        while ((int) out.getNumBytesAsUTF8() > maxBytes && out.isNotEmpty())
            out = out.dropLastCharacters (1);
        return out;
    }

    inline juce::File findMainBinary (const juce::File& bundle)
    {
       #if JUCE_MAC
        auto files = bundle.getChildFile ("Contents").getChildFile ("MacOS")
                           .findChildFiles (juce::File::findFiles, false);
        return files.isEmpty() ? juce::File() : files[0];
       #else
        auto contents = bundle.getChildFile ("Contents");
        for (auto& d : contents.findChildFiles (juce::File::findDirectories, false))
            for (auto& f : d.findChildFiles (juce::File::findFiles, false))
                if (f.getFileName().endsWithIgnoreCase (".vst3") || f.getFileName().endsWithIgnoreCase (".so"))
                    return f;
        return {};
       #endif
    }

    // Overwrite every occurrence of `from` with the same-length `to`; returns hits.
    inline int replaceBytes (juce::MemoryBlock& mb, const juce::String& from, const juce::String& to)
    {
        auto* data = static_cast<char*> (mb.getData());
        const int n = (int) mb.getSize();
        const char* f = from.toRawUTF8(); const int fl = (int) from.getNumBytesAsUTF8();
        const char* t = to.toRawUTF8();
        int hits = 0;
        for (int i = 0; i + fl <= n; )
        {
            if (std::memcmp (data + i, f, (size_t) fl) == 0) { std::memcpy (data + i, t, (size_t) fl); ++hits; i += fl; }
            else ++i;
        }
        return hits;
    }

    // Replace a NUL-terminated C string `oldStr` (only where it is actually
    // NUL-terminated, so a longer string that merely starts with it — e.g. a path —
    // is left alone) with `newStr`, NUL-padding the rest to keep the length identical.
    inline int replaceCString (juce::MemoryBlock& mb, const juce::String& oldStr, const juce::String& newStr)
    {
        auto* data = static_cast<char*> (mb.getData());
        const int n = (int) mb.getSize();
        const char* o = oldStr.toRawUTF8(); const int ol = (int) oldStr.getNumBytesAsUTF8();
        const char* np = newStr.toRawUTF8(); int nl = (int) newStr.getNumBytesAsUTF8();
        if (nl > ol) nl = ol;
        int hits = 0;
        for (int i = 0; i + ol < n; )
        {
            if (std::memcmp (data + i, o, (size_t) ol) == 0 && data[i + ol] == 0)
            {
                std::memcpy (data + i, np, (size_t) nl);
                std::memset (data + i + nl, 0, (size_t) (ol - nl));
                ++hits; i += ol;
            }
            else ++i;
        }
        return hits;
    }

    // Write `mb` back over `f` IN PLACE (no recreate) so the file keeps its mode bits
    // — recreating drops the +x the plugin needs. Lengths match, so no truncation.
    inline bool writeInPlace (const juce::File& f, const juce::MemoryBlock& mb)
    {
        juce::FileOutputStream out (f);
        if (out.failedToOpen()) return false;
        out.setPosition (0);
        const bool ok = out.write (mb.getData(), mb.getSize());
        out.flush();
        return ok;
    }

    inline void patchModuleInfo (const juce::File& bundle,
                                 const juce::String& oldTailHex, const juce::String& newTailHex,
                                 const juce::String& oldName,    const juce::String& newName)
    {
        auto mi = bundle.getChildFile ("Contents").getChildFile ("Resources").getChildFile ("moduleinfo.json");
        if (! mi.existsAsFile()) return;
        auto text = mi.loadFileAsString();
        text = text.replace (oldTailHex, newTailHex, true)   // CID tails (hex, ignore case)
                   .replace (oldName,    newName,    false);  // class names
        mi.replaceWithText (text);
    }

    // Re-identify the copied bundle: unique CID + product list-name. Returns true if
    // the CID was rewritten (a real new plugin); false (+ `warnOut`) means the markers
    // weren't found and the copy keeps VibePlugin's shared id. `newCodeOut` is the id.
    inline bool patchIdentity (const juce::File& bundle, const juce::String& oldName,
                               const juce::String& oldCode, const juce::String& productName,
                               juce::String& newCodeOut, juce::String& warnOut)
    {
        const juce::String manuf   = "Vsai";
        const juce::String newCode = derivePluginCode (productName, oldCode);
        const juce::String newName = sanitizeName (productName, (int) oldName.getNumBytesAsUTF8());
        newCodeOut = newCode;

        auto bin = findMainBinary (bundle);
        if (! bin.existsAsFile()) { warnOut = "plugin binary not found"; return false; }

        juce::MemoryBlock mb;
        if (! bin.loadFileAsData (mb)) { warnOut = "could not read the plugin binary"; return false; }

        const int cidHits = replaceBytes (mb, manuf + oldCode, manuf + newCode);
        juce::ignoreUnused (replaceCString (mb, oldName, newName));   // list name (best effort)

        if (cidHits == 0)               { warnOut = "identity markers not found (build changed?)"; return false; }
        if (! writeInPlace (bin, mb))   { warnOut = "could not write the re-identified binary";    return false; }
        bin.setExecutePermission (true);

        patchModuleInfo (bundle, fourCharHex (manuf + oldCode), fourCharHex (manuf + newCode), oldName, newName);
        return true;
    }

    // --- the export itself ---------------------------------------------------

    // Produce `destBundle` (a *.vst3) from `srcBundle`, baking `doc` in as a
    // locked creation named `productName`. Returns false with a human-readable
    // `errOut` on failure. Pure file/process work — safe off the message thread.
    inline bool exportPlugin (const juce::File& srcBundle,
                              const juce::File& destBundle,
                              const VstaiDocument& doc,
                              const juce::String& productName,
                              const juce::String& oldName,
                              const juce::String& oldCode,
                              const juce::String& notaryProfile,
                              const std::function<void(const juce::String&)>& progress,
                              juce::String& messageOut)
    {
        auto note = [&progress] (const juce::String& s) { if (progress) progress (s); };

        if (! srcBundle.isDirectory())
        {
            messageOut = "could not locate the running plugin bundle to copy.";
            return false;
        }
        if (! doc.hasPlugin())
        {
            messageOut = "nothing to export yet — generate a plugin first.";
            return false;
        }

        if (destBundle.exists() && ! destBundle.deleteRecursively())
        {
            messageOut = "could not overwrite " + destBundle.getFullPathName();
            return false;
        }
        destBundle.getParentDirectory().createDirectory();

        note ("Copying the plugin…");
        if (! copyBundle (srcBundle, destBundle, messageOut))
            return false;

        // Bake the locked creation into the copy's Resources. Strip the authoring-
        // only data: a whitelabel product runs purely from the compiled WASM + GUI +
        // params, so the AssemblyScript source, prompt history and revision timeline
        // are dropped (protects the creator's IP and shrinks the file).
        VstaiDocument baked = doc;
        baked.locked = true;
        if (productName.trim().isNotEmpty()) baked.name = productName.trim();
        baked.assembly.clear();
        baked.lastExplanation.clear();
        baked.promptHistory.clear();
        baked.revisions.clear();
        baked.activeRevision = 0;
        baked.nextRevisionId = 1;

        auto resources = destBundle.getChildFile ("Contents").getChildFile ("Resources");
        if (! resources.isDirectory() && ! resources.createDirectory())
        {
            messageOut = "no Resources/ in the copied bundle.";
            return false;
        }
        juce::String saveErr;
        if (! baked.saveToFile (resources.getChildFile (kBakedDocName), saveErr))
        {
            messageOut = "could not write the baked creation: " + saveErr;
            return false;
        }

        // A locked product needs neither the compiler nor the authoring shell.
        note ("Slimming the bundle…");
        stripUnusedForLocked (destBundle);

        setBundleDisplayName (destBundle, baked.name);

        // Give the copy its own VST3 identity + list name so it's a real new plugin
        // (coexists with VibePlugin and other exports). Non-fatal: if the markers
        // aren't found we ship a working copy that shares VibePlugin's id.
        juce::String newCode, idWarn;
        const bool uniqueId = patchIdentity (destBundle, oldName, oldCode, baked.name, newCode, idWarn);

        // Sign last so the seal covers the baked doc, the slimmed Resources, and the
        // patched binary + moduleinfo. Hardened runtime => notarizable.
        const bool willNotarize = notaryProfile.isNotEmpty();
        note ("Signing (Developer ID, hardened runtime)…");
        if (! signForExport (destBundle, willNotarize, messageOut))
            return false;

        juce::String notaryOut;
        const bool notarized = willNotarize && notarize (destBundle, notaryProfile, progress, notaryOut);

        const juce::String idPart = uniqueId
            ? ("its own identity (id " + newCode + ")")
            : ("VibePlugin's shared id — " + idWarn);

        juce::String trust;
        if (notarized)
            trust = "Notarized — it loads cleanly on any Mac.";
        else if (notaryProfile.isEmpty())
            trust = "Signed with your Developer ID (hardened runtime). Not notarized: set a notary "
                    "profile in Settings to auto-notarize, or recipients clear quarantine once.";
        else
            trust = "Signed, but notarization did not complete: " + notaryOut;

        messageOut = "Exported \xE2\x80\x9C" + baked.name + "\xE2\x80\x9D with " + idPart
                   + ", locked to just the GUI. " + trust;
        return true;
    }
}
