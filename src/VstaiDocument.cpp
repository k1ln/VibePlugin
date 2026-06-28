// VstaiDocument.cpp
#include "VstaiDocument.h"

namespace
{
    juce::String wasmToBase64 (const std::vector<uint8_t>& bytes)
    {
        if (bytes.empty()) return {};
        return juce::Base64::toBase64 (bytes.data(), bytes.size());
    }

    std::vector<uint8_t> base64ToWasm (const juce::String& b64)
    {
        juce::MemoryOutputStream mos;
        if (b64.isEmpty() || ! juce::Base64::convertFromBase64 (mos, b64))
            return {};
        const auto* data = static_cast<const uint8_t*> (mos.getData());
        return std::vector<uint8_t> (data, data + mos.getDataSize());
    }

    juce::var paramToVar (const VstaiParam& p)
    {
        auto* po = new juce::DynamicObject();
        po->setProperty ("name",    p.name);
        po->setProperty ("index",   p.index);
        po->setProperty ("min",     p.minVal);
        po->setProperty ("max",     p.maxVal);
        po->setProperty ("default", p.defVal);
        po->setProperty ("value",   p.value);
        return juce::var (po);
    }

    VstaiParam paramFromVar (const juce::var& pv)
    {
        VstaiParam p;
        if (auto* po = pv.getDynamicObject())
        {
            p.name   = po->getProperty ("name").toString();
            p.index  = (int)    po->getProperty ("index");
            p.minVal = (double) po->getProperty ("min");
            p.maxVal = (double) po->getProperty ("max");
            p.defVal = (double) po->getProperty ("default");
            p.value  = po->hasProperty ("value") ? (double) po->getProperty ("value") : p.defVal;
        }
        return p;
    }

    juce::var revisionToVar (const VstaiRevision& r)
    {
        auto* o = new juce::DynamicObject();
        o->setProperty ("id",           r.id);
        o->setProperty ("parent",       r.parent);
        o->setProperty ("prompt",       r.prompt);
        o->setProperty ("assembly",     r.assembly);
        o->setProperty ("html",         r.html);
        o->setProperty ("explanation",  r.explanation);
        o->setProperty ("provider",     r.provider);
        o->setProperty ("model",        r.model);
        o->setProperty ("wasmBase64",   wasmToBase64 (r.wasm));
        o->setProperty ("isInstrument", r.isInstrument);
        o->setProperty ("timestamp",    r.timestamp);

        juce::Array<juce::var> ps;
        for (const auto& p : r.params) ps.add (paramToVar (p));
        o->setProperty ("params", ps);
        return juce::var (o);
    }

    VstaiRevision revisionFromVar (const juce::var& v)
    {
        VstaiRevision r;
        if (auto* o = v.getDynamicObject())
        {
            r.id           = (int) o->getProperty ("id");
            r.parent       = (int) o->getProperty ("parent");
            r.prompt       = o->getProperty ("prompt").toString();
            r.assembly     = o->getProperty ("assembly").toString();
            r.html         = o->getProperty ("html").toString();
            r.explanation  = o->getProperty ("explanation").toString();
            r.provider     = o->getProperty ("provider").toString();
            r.model        = o->getProperty ("model").toString();
            r.wasm         = base64ToWasm (o->getProperty ("wasmBase64").toString());
            r.isInstrument = (bool) o->getProperty ("isInstrument");
            r.timestamp    = (juce::int64) o->getProperty ("timestamp");
            if (auto* ps = o->getProperty ("params").getArray())
                for (const auto& pv : *ps) r.params.push_back (paramFromVar (pv));
        }
        return r;
    }
}

juce::var VstaiDocument::toVar() const
{
    auto* obj = new juce::DynamicObject();
    obj->setProperty ("format",       kFormatVersion);
    obj->setProperty ("name",         name);
    obj->setProperty ("assembly",     assembly);
    obj->setProperty ("html",         html);
    obj->setProperty ("wasmBase64",   wasmToBase64 (wasm));
    obj->setProperty ("explanation",  lastExplanation);
    obj->setProperty ("isInstrument", isInstrument);
    obj->setProperty ("locked",       locked);
    obj->setProperty ("provider",     provider);
    obj->setProperty ("model",        model);
    obj->setProperty ("effort",       effort);
    obj->setProperty ("thinking",     thinking);

    juce::Array<juce::var> hist;
    for (const auto& p : promptHistory) hist.add (p);
    obj->setProperty ("promptHistory", hist);

    juce::Array<juce::var> ps;
    for (const auto& p : params)
    {
        auto* po = new juce::DynamicObject();
        po->setProperty ("name",    p.name);
        po->setProperty ("index",   p.index);
        po->setProperty ("min",     p.minVal);
        po->setProperty ("max",     p.maxVal);
        po->setProperty ("default", p.defVal);
        po->setProperty ("value",   p.value);
        ps.add (juce::var (po));
    }
    obj->setProperty ("params", ps);

    juce::Array<juce::var> revs;
    for (const auto& r : revisions) revs.add (revisionToVar (r));
    obj->setProperty ("revisions",      revs);
    obj->setProperty ("activeRevision", activeRevision);
    obj->setProperty ("nextRevisionId", nextRevisionId);

    return juce::var (obj);
}

VstaiDocument VstaiDocument::fromVar (const juce::var& v)
{
    VstaiDocument d;
    if (auto* obj = v.getDynamicObject())
    {
        d.name            = obj->getProperty ("name").toString();
        d.assembly        = obj->getProperty ("assembly").toString();
        d.html            = obj->getProperty ("html").toString();
        d.lastExplanation = obj->getProperty ("explanation").toString();
        d.isInstrument    = (bool) obj->getProperty ("isInstrument");
        d.locked          = (bool) obj->getProperty ("locked");
        d.wasm            = base64ToWasm (obj->getProperty ("wasmBase64").toString());
        if (obj->hasProperty ("model"))    d.model    = obj->getProperty ("model").toString();
        if (obj->hasProperty ("effort"))   d.effort   = obj->getProperty ("effort").toString();
        if (obj->hasProperty ("thinking")) d.thinking = (bool) obj->getProperty ("thinking");
        if (obj->hasProperty ("provider")) d.provider = obj->getProperty ("provider").toString();

        if (auto* hist = obj->getProperty ("promptHistory").getArray())
            for (const auto& h : *hist) d.promptHistory.add (h.toString());

        if (auto* ps = obj->getProperty ("params").getArray())
        {
            for (const auto& pv : *ps)
            {
                if (auto* po = pv.getDynamicObject())
                {
                    VstaiParam p;
                    p.name   = po->getProperty ("name").toString();
                    p.index  = (int)    po->getProperty ("index");
                    p.minVal = (double) po->getProperty ("min");
                    p.maxVal = (double) po->getProperty ("max");
                    p.defVal = (double) po->getProperty ("default");
                    p.value  = po->hasProperty ("value") ? (double) po->getProperty ("value")
                                                         : p.defVal;
                    d.params.push_back (p);
                }
            }
        }

        if (auto* revs = obj->getProperty ("revisions").getArray())
            for (const auto& rv : *revs) d.revisions.push_back (revisionFromVar (rv));
        if (obj->hasProperty ("activeRevision")) d.activeRevision = (int) obj->getProperty ("activeRevision");
        if (obj->hasProperty ("nextRevisionId")) d.nextRevisionId = (int) obj->getProperty ("nextRevisionId");
        if (d.nextRevisionId < 1) d.nextRevisionId = 1;
    }
    return d;
}

juce::String VstaiDocument::toJsonString() const
{
    return juce::JSON::toString (toVar(), false);
}

VstaiDocument VstaiDocument::fromJsonString (const juce::String& json)
{
    return fromVar (juce::JSON::parse (json));
}

bool VstaiDocument::saveToFile (const juce::File& file, juce::String& errorOut) const
{
    auto tmp = file.getSiblingFile (file.getFileName() + ".tmp");
    if (! tmp.replaceWithText (toJsonString()))
    {
        errorOut = "could not write " + tmp.getFullPathName();
        return false;
    }
    if (! tmp.moveFileTo (file))
    {
        errorOut = "could not finalise " + file.getFullPathName();
        return false;
    }
    return true;
}

bool VstaiDocument::loadFromFile (const juce::File& file, VstaiDocument& out, juce::String& errorOut)
{
    if (! file.existsAsFile()) { errorOut = "file not found"; return false; }
    auto parsed = juce::JSON::parse (file.loadFileAsString());
    if (! parsed.isObject())   { errorOut = "not a valid .vstai file"; return false; }
    out = fromVar (parsed);
    return true;
}

void VstaiDocument::applyBuildResult (const juce::var& r,
                                      const std::vector<uint8_t>& wasmBytes,
                                      const juce::String& prompt)
{
    if (auto* obj = r.getDynamicObject())
    {
        assembly        = obj->getProperty ("assembly").toString();
        wasm            = wasmBytes;

        const juce::String newName = obj->getProperty ("name").toString().trim();
        if (newName.isNotEmpty())
            name = newName;

        // A reply may legitimately omit the GUI ("HTML unchanged — keep it") or the
        // params block. Only overwrite those when the artifact actually carried them,
        // otherwise keep the current ones so partial replies don't blank the editor.
        const juce::String newHtml = obj->getProperty ("html").toString();
        if (newHtml.isNotEmpty())
            html = newHtml;

        const juce::String newExplanation = obj->getProperty ("explanation").toString();
        if (newExplanation.isNotEmpty())
            lastExplanation = newExplanation;

        if (auto* ps = obj->getProperty ("params").getArray())
        {
            if (ps->size() > 0)
            {
                params.clear();
                for (const auto& pv : *ps)
                {
                    if (auto* po = pv.getDynamicObject())
                    {
                        VstaiParam p;
                        p.name   = po->getProperty ("name").toString();
                        p.index  = (int)    po->getProperty ("index");
                        p.minVal = (double) po->getProperty ("min");
                        p.maxVal = (double) po->getProperty ("max");
                        p.defVal = (double) po->getProperty ("default");
                        p.value  = p.defVal;
                        params.push_back (p);
                    }
                }
            }
        }
    }

    if (prompt.trim().isNotEmpty())
        promptHistory.add (prompt.trim());

    pushRevision (prompt.trim());
}

void VstaiDocument::pushRevision (const juce::String& promptLabel)
{
    VstaiRevision r;
    r.id           = nextRevisionId++;
    r.parent       = activeRevision;
    r.prompt       = promptLabel;
    r.assembly     = assembly;
    r.html         = html;
    r.explanation  = lastExplanation;
    r.provider     = provider;
    r.model        = model;
    r.wasm         = wasm;
    r.params       = params;
    r.isInstrument = isInstrument;
    r.timestamp    = juce::Time::getCurrentTime().toMilliseconds();

    revisions.push_back (std::move (r));
    activeRevision = revisions.back().id;

    // Cap the number of full snapshots we keep (drop the oldest). Referencing
    // by id means a now-missing parent just renders as a root — no dangling.
    while ((int) revisions.size() > kMaxRevisions)
        revisions.erase (revisions.begin());
}

bool VstaiDocument::restoreRevision (int id)
{
    for (const auto& r : revisions)
    {
        if (r.id == id)
        {
            assembly        = r.assembly;
            html            = r.html;
            lastExplanation = r.explanation;
            provider        = r.provider;
            model           = r.model;
            wasm            = r.wasm;
            params          = r.params;
            isInstrument    = r.isInstrument;
            activeRevision  = id;
            return true;
        }
    }
    return false;
}
