# License Template — exported VibePlugin product
### Engine: AGPL-3.0 · Creation (WASM, GUI, presets, …): commercial

> **How to use this template.** You exported a plugin from VibePlugin and want to
> sell it. Copy this file, replace every `[PLACEHOLDER]`, delete this box and the
> checklist at the end, and ship the result as `LICENSE.txt` inside your product
> (and with your installer / download page). The template is a starting point,
> **not legal advice** — have a lawyer review it before you sell at scale.

---

# [PRODUCT NAME] — License Agreement

Version [LICENSE VERSION] · [DATE]

**Licensor of the Creation:** [YOUR NAME OR COMPANY], [ADDRESS], [CONTACT E-MAIL]
(“**Licensor**”)

**You:** the person or company that installs or uses [PRODUCT NAME]
(“**Licensee**”).

[PRODUCT NAME] is made of two separate parts that are licensed differently.
Section 2 covers the Engine (open source). Section 3 covers the Creation
(commercial). Section 4 explains how the two relate.

---

## 1. Definitions

- **Product** — the installable plugin bundle “[PRODUCT NAME]” (e.g.
  `[PRODUCT NAME].vst3`) as delivered by the Licensor.
- **Engine** — everything in the Product that comes from VibePlugin and its
  libraries: the plugin host code, audio/MIDI plumbing, the WebAssembly runtime,
  the WebView shell that displays the GUI, the VibePlugin binary as copied by
  “Export plugin…”, and the libraries compiled into it (JUCE, wasmtime, and any
  others listed in `NOTICE.txt`).
- **Creation** — the Licensor’s own work that the Engine loads at run time,
  contained in `Contents/Resources/baked.vstai` and any files beside it:
  - the compiled DSP module (WebAssembly),
  - the graphical user interface (HTML, CSS, JavaScript, images, fonts),
  - parameter metadata, presets, factory sounds, wavetables and samples,
  - the product name, artwork, manual and branding.
- **Engine Source** — the complete corresponding source code of the Engine, as
  defined in the GNU Affero General Public License v3.0 (“AGPL-3.0”).

## 2. The Engine — GNU Affero General Public License v3.0

2.1 The Engine is free software. It is licensed to you under **AGPL-3.0**
(text: `LICENSE-AGPL-3.0.txt` in this Product, or
<https://www.gnu.org/licenses/agpl-3.0.html>). Nothing in Section 3 limits the
rights AGPL-3.0 gives you in the Engine.

2.2 **Engine Source.** The Engine Source for the exact version shipped in this
Product is available at **<https://github.com/k1ln/VibePlugin>**, tag/commit
`[VIBEPLUGIN VERSION / COMMIT]`. The Licensor also offers, for at least three
years after the Licensor last distributed this Product and for as long as it
supports it, to send you the Engine Source on request to [CONTACT E-MAIL], for
no more than the cost of physically providing it. This is the written offer
required by AGPL-3.0 §6.

2.3 **Libraries inside the Engine** keep their own licenses, listed in
`NOTICE.txt`:

| Component | License |
|---|---|
| VibePlugin engine | AGPL-3.0 |
| JUCE 8 | AGPL-3.0 (<https://github.com/juce-framework/JUCE>) |
| wasmtime | Apache-2.0 WITH LLVM-exception |
| [OTHER COMPONENTS FROM NOTICE.txt] | [LICENSE] |

2.4 **Modifying the Engine.** If you modify the Engine and convey it to others,
or let others interact with it over a network, AGPL-3.0 applies to your
modifications. You may replace the Creation with a different one or run the
Engine without a Creation.

## 3. The Creation — Commercial License

3.1 **Ownership.** The Creation is protected by copyright and other laws. The
Licensor (or its licensors) owns it. It is **not** licensed under AGPL-3.0 and
is **not** open source. All rights not expressly granted are reserved.

3.2 **Grant.** Subject to this Agreement and payment of the license fee
[PRICE / “has been paid”], the Licensor grants you a non-exclusive,
non-transferable (except as in 3.5), worldwide license to install and use the
Creation, loaded by the Engine, on up to [NUMBER] computers that you own or
control, for your own [PERSONAL / COMMERCIAL] music and audio production,
including commercial releases of music made with it.

3.3 **Restrictions.** Unless the law or Section 2 gives you the right
regardless, you may not:

- copy, distribute, sell, rent, lease, sublicense or share the Creation, in whole
  or in part, on its own or inside another product, sample pack or plugin;
- extract, decompile, disassemble or reverse engineer the Creation (the WASM
  module, GUI or presets) or remove it from the Product;
- remove or alter copyright, license or branding notices in the Creation;
- circumvent [LICENSE KEY / ACTIVATION / COPY PROTECTION, IF ANY];
- use the Creation to train a machine-learning model or to build a competing
  product.

3.4 **Third-party content in the Creation.** [LIST ANY SAMPLES, WAVETABLES,
FONTS OR CODE FROM THIRD PARTIES AND THEIR LICENSES, OR WRITE “None.”]

3.5 **Transfer.** [YOU MAY TRANSFER YOUR LICENSE ONCE TO ANOTHER PERSON IF YOU
DELETE ALL COPIES AND NOTIFY THE LICENSOR. / THE LICENSE IS NOT TRANSFERABLE.]

3.6 **Updates and support.** [UPDATES AND SUPPORT ARE / ARE NOT INCLUDED, FOR
[PERIOD].]

3.7 **Term.** The license lasts [PERPETUALLY / FOR [TERM]] and ends
automatically if you breach Section 3. It ends only your rights in the Creation;
your rights in the Engine under Section 2 are unaffected.

## 4. How the two parts relate

4.1 **Separate works.** The Creation is data and a compiled module that the
Engine loads and runs through the Engine’s documented plugin interface. The
Creation does not contain Engine code and can be replaced or removed without
changing the Engine. The Licensor’s position is that the Creation is therefore a
separate work from the Engine, and that AGPL-3.0 does not apply to it.

4.2 **No restriction on the Engine.** No term of Section 3 applies to the Engine,
and Section 3 is not to be read as restricting any right AGPL-3.0 gives you in
the Engine (including running it, studying it, modifying it and conveying it).

4.3 **Precedence.** If a term of this Agreement conflicts with AGPL-3.0 on the
Engine, AGPL-3.0 prevails for the Engine. For the Creation, Section 3 prevails.

## 5. Warranty and liability

5.1 The **Engine** is provided “as is”, **without any warranty**, as stated in
AGPL-3.0 §§15–17.

5.2 The **Creation** is provided [“as is” / WITH THE WARRANTY OF [PERIOD] THAT IT
WILL SUBSTANTIALLY WORK AS DESCRIBED IN THE MANUAL]. To the maximum extent
permitted by law the Licensor excludes all other warranties and is not liable
for indirect or consequential loss, lost data, lost profit or damage to
equipment or recordings, and its total liability is limited to the license fee
you paid. Nothing in this Agreement excludes liability that cannot be excluded
by law (for example for intent, gross negligence or injury to life, body or
health).

## 6. General

6.1 **Privacy.** [THE PRODUCT DOES NOT / DOES COLLECT [DATA] — STATE IT HERE.]

6.2 **Entire agreement.** This Agreement, `LICENSE-AGPL-3.0.txt` and `NOTICE.txt`
are the whole agreement about the Product. Changes must be in writing.

6.3 **Severability.** If a provision is invalid, the rest stays in force.

6.4 **Governing law and venue.** [COUNTRY / STATE] law applies, excluding its
conflict-of-law rules and the UN Sales Convention. [COURT / CITY] has
jurisdiction, subject to mandatory consumer-protection rules.

---

## Files to ship with the Product

```
[PRODUCT NAME].vst3/Contents/Resources/
    LICENSE.txt            ← this Agreement, filled in
    LICENSE-AGPL-3.0.txt   ← verbatim copy of the repository's LICENSE file
    NOTICE.txt             ← Engine + library attributions (wasmtime Apache-2.0
                             notice, JUCE, anything else in the bundle), plus
                             the Engine Source link from §2.2
```

Also put the Engine Source link (§2.2) on your download or store page.

---

## Checklist for the exporter *(delete before shipping)*

1. **JUCE.** The Engine contains JUCE, which is itself AGPL-3.0 *or* commercially
   licensed by its vendor. Under AGPL the Engine stays open (this template does
   exactly that), so selling the Product is fine as long as you honour §2. If you
   want to ship the Engine **without** AGPL obligations, you need a commercial
   license from JUCE and from the VibePlugin author — this template does not give
   you that.
2. **Don’t restrict the Engine.** Don’t add an EULA clause, DRM, or technical
   measure that stops people from running, modifying or redistributing the
   Engine as AGPL allows. Your protection (license key, activation, encrypted
   presets) may apply to the Creation only.
3. **Keep the separation true.** The Creation must only run through the Engine’s
   plugin interface. Don’t link, patch or embed Engine code into your Creation or
   your own helper libraries; if you do, those parts may fall under AGPL too.
4. **Source link must stay valid** for the version you ship (pin a tag or commit).
5. **Third-party assets.** Samples, wavetables (for example the BVKER wavetables
   used by some VibePlugin examples), fonts and code inside the Creation need
   licenses that allow commercial redistribution. Fill in §3.4 honestly.
6. **AI-generated content.** Check the terms of the AI provider you used and your
   local law on copyright in machine-generated code/audio before you claim
   exclusive ownership in §3.1.
7. **Trademarks.** Do not use the “VibePlugin” name or logo as the name of your
   Product unless the VibePlugin author permits it. Describe the Product as
   “made with VibePlugin” if you like.
8. **Upstream permission.** The strongest basis for 4.1 is an explicit statement by
   the VibePlugin copyright holder that Creations are not covered by the AGPL
   (an additional permission under AGPL-3.0 §7). Check the VibePlugin README /
   LICENSE for that wording; without it, 4.1 is your reasoned position, not a
   guarantee.
