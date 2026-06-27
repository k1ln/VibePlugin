// LicensePanel.h
// =====================================================================
//  The "License…" dialog. VibePlugin is shareware: fully functional, with a
//  friendly nag until you buy a one-time lifetime license. A license is tied
//  to an email and a key; activating registers this install on the license
//  server (max 5 activations — the oldest is invalidated past 5). Network work
//  runs on a background thread and is marshalled back via a SafePointer.
// =====================================================================

#pragma once

#include <juce_gui_extra/juce_gui_extra.h>
#include <thread>
#include <atomic>
#include "AppSettings.h"
#include "LicenseClient.h"

class LicensePanel : public juce::Component
{
public:
    LicensePanel()
    {
        baseUrl = vstai::appsettings::licenseServerUrl();

        title.setText ("VibePlugin — lifetime license", juce::dontSendNotification);
        title.setFont (juce::Font (juce::FontOptions (16.0f)));
        title.setColour (juce::Label::textColourId, juce::Colour (0xff9fb4d8));
        addAndMakeVisible (title);

        blurb.setColour (juce::Label::textColourId, juce::Colours::lightgrey);
        blurb.setJustificationType (juce::Justification::topLeft);
        blurb.setText ("One payment, yours forever, up to 5 machines. It only removes the friendly "
                       "warning — every feature already works unlicensed.", juce::dontSendNotification);
        addAndMakeVisible (blurb);

        emailLabel.setText ("Email", juce::dontSendNotification);
        emailLabel.setColour (juce::Label::textColourId, juce::Colours::grey);
        emailBox.setText (vstai::appsettings::licenseEmail(), juce::dontSendNotification);
        emailBox.setTextToShowWhenEmpty ("you@example.com", juce::Colours::grey);
        addChildComponent (emailLabel);
        addChildComponent (emailBox);

        keyLabel.setText ("License key", juce::dontSendNotification);
        keyLabel.setColour (juce::Label::textColourId, juce::Colours::grey);
        keyBox.setText (vstai::appsettings::licenseKey(), juce::dontSendNotification);
        keyBox.setTextToShowWhenEmpty ("VSTAI-XXXX-XXXX-XXXX-XXXX", juce::Colours::grey);
        addChildComponent (keyLabel);
        addChildComponent (keyBox);

        activateBtn.onClick   = [this] { doActivate(); };
        deactivateBtn.onClick = [this] { doDeactivate(); };
        buyBtn.onClick        = [this] { doBuy(); };
        addChildComponent (activateBtn);
        addChildComponent (deactivateBtn);
        addAndMakeVisible (buyBtn);

        info.setColour (juce::Label::textColourId, juce::Colours::white);
        info.setJustificationType (juce::Justification::topLeft);
        addChildComponent (info);

        status.setColour (juce::Label::textColourId, juce::Colours::lightgrey);
        status.setJustificationType (juce::Justification::topLeft);
        addAndMakeVisible (status);

        setSize (440, 320);
        updateState();
        if (vstai::appsettings::isLicensed()) doValidate();
    }

    // Editor refreshes its license button label when state changes.
    std::function<void()> onChanged;

    void resized() override
    {
        auto r = getLocalBounds().reduced (14);
        title.setBounds (r.removeFromTop (24));
        r.removeFromTop (2);
        blurb.setBounds (r.removeFromTop (40));
        r.removeFromTop (6);

        const bool licensed = vstai::appsettings::isLicensed();
        if (! licensed)
        {
            emailLabel.setBounds (r.removeFromTop (16));
            emailBox.setBounds   (r.removeFromTop (26));
            r.removeFromTop (6);
            keyLabel.setBounds (r.removeFromTop (16));
            keyBox.setBounds   (r.removeFromTop (26));
            r.removeFromTop (10);
            auto row = r.removeFromTop (30);
            activateBtn.setBounds (row.removeFromLeft (160));
            row.removeFromLeft (8);
            buyBtn.setBounds (row.removeFromLeft (180));
        }
        else
        {
            info.setBounds (r.removeFromTop (44));
            r.removeFromTop (8);
            auto row = r.removeFromTop (30);
            deactivateBtn.setBounds (row.removeFromLeft (170));
            row.removeFromLeft (8);
            buyBtn.setBounds (row.removeFromLeft (180));
        }

        r.removeFromTop (10);
        status.setBounds (r);
    }

private:
    void setStatus (const juce::String& s, bool error = false)
    {
        status.setColour (juce::Label::textColourId, error ? juce::Colour (0xffff8888)
                                                           : juce::Colours::lightgrey);
        status.setText (s, juce::dontSendNotification);
    }

    void updateState()
    {
        const bool licensed = vstai::appsettings::isLicensed();
        emailLabel.setVisible (! licensed);
        emailBox.setVisible   (! licensed);
        keyLabel.setVisible   (! licensed);
        keyBox.setVisible     (! licensed);
        activateBtn.setVisible (! licensed);
        info.setVisible (licensed);
        deactivateBtn.setVisible (licensed);
        buyBtn.setButtonText (licensed ? "Buy another / manage" : "Buy lifetime license");
        if (licensed)
            info.setText ("Licensed to " + vstai::appsettings::licenseEmail() + ".\nThank you!",
                          juce::dontSendNotification);
        resized();
    }

    void doActivate()
    {
        const auto email = emailBox.getText().trim().toLowerCase();
        const auto key   = keyBox.getText().trim();
        if (! email.containsChar ('@')) { setStatus ("Enter the email you bought with.", true); return; }
        if (key.isEmpty())              { setStatus ("Paste your license key.", true); return; }
        if (busy.exchange (true)) return;

        activateBtn.setEnabled (false);
        setStatus ("Activating…");

        juce::Component::SafePointer<LicensePanel> safe (this);
        const auto base = baseUrl;
        const auto machine = vstai::appsettings::machineId();
        const auto name = juce::SystemStats::getComputerName();
        std::thread ([safe, base, key, email, machine, name]
        {
            auto resp = vstai::license::activate (base, key, email, machine, name);
            juce::MessageManager::callAsync ([safe, resp, key, email]
            {
                if (safe == nullptr) return;
                safe->busy = false;
                safe->activateBtn.setEnabled (true);
                if (! resp.ok())
                {
                    safe->setStatus ("Couldn't activate: " + resp.error(), true);
                    return;
                }
                vstai::appsettings::setLicense (key, email,
                    resp.json.getProperty ("activation_id", {}).toString());
                const int used = (int) resp.json.getProperty ("activations_used", 1);
                const int max  = (int) resp.json.getProperty ("max_activations", 5);
                safe->updateState();
                safe->setStatus ("Activated — using " + juce::String (used) + " of "
                                 + juce::String (max) + " machines. The warning is gone. Enjoy!");
                safe->notify();
            });
        }).detach();
    }

    void doValidate()
    {
        juce::Component::SafePointer<LicensePanel> safe (this);
        const auto base = baseUrl;
        const auto key = vstai::appsettings::licenseKey();
        const auto machine = vstai::appsettings::machineId();
        std::thread ([safe, base, key, machine]
        {
            auto resp = vstai::license::validate (base, key, machine);
            juce::MessageManager::callAsync ([safe, resp]
            {
                if (safe == nullptr) return;
                // Fail-open: only an explicit, reachable "valid:false" clears it.
                if (resp.transportOk && resp.status >= 200 && resp.status < 300
                    && resp.json.isObject() && ! (bool) resp.json.getProperty ("valid", true))
                {
                    vstai::appsettings::clearLicense();
                    safe->updateState();
                    safe->setStatus ("This license is no longer valid on this machine.", true);
                    safe->notify();
                    return;
                }
                if (resp.ok())
                {
                    const int used = (int) resp.json.getProperty ("activations_used", 0);
                    if (used > 0)
                        safe->info.setText ("Licensed to " + vstai::appsettings::licenseEmail()
                                            + ".\nUsing " + juce::String (used) + " of 5 machines.",
                                            juce::dontSendNotification);
                }
            });
        }).detach();
    }

    void doDeactivate()
    {
        if (busy.exchange (true)) return;
        deactivateBtn.setEnabled (false);
        setStatus ("Releasing this machine…");

        juce::Component::SafePointer<LicensePanel> safe (this);
        const auto base = baseUrl;
        const auto key = vstai::appsettings::licenseKey();
        const auto machine = vstai::appsettings::machineId();
        std::thread ([safe, base, key, machine]
        {
            vstai::license::deactivate (base, key, machine);
            juce::MessageManager::callAsync ([safe]
            {
                if (safe == nullptr) return;
                safe->busy = false;
                safe->deactivateBtn.setEnabled (true);
                vstai::appsettings::clearLicense();
                safe->updateState();
                safe->setStatus ("This machine was released. The license is free to use elsewhere.");
                safe->notify();
            });
        }).detach();
    }

    void doBuy()
    {
        juce::String url = vstai::appsettings::licenseCheckoutUrl();
        if (url.isEmpty()) url = vstai::appsettings::licenseServerUrl();
        const auto email = emailBox.getText().trim().toLowerCase();
        if (email.containsChar ('@'))
            url += (url.containsChar ('?') ? "&" : "?") + juce::String ("checkout[email]=")
                 + juce::URL::addEscapeChars (email, true);
        juce::URL (url).launchInDefaultBrowser();
    }

    void notify() { if (onChanged) onChanged(); }

    juce::String baseUrl;
    std::atomic<bool> busy { false };

    juce::Label      title, blurb, emailLabel, keyLabel, info, status;
    juce::TextEditor emailBox, keyBox;
    juce::TextButton activateBtn   { "Activate license" };
    juce::TextButton deactivateBtn { "Release this machine" };
    juce::TextButton buyBtn        { "Buy lifetime license" };

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (LicensePanel)
};
