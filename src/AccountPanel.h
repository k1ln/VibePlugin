// AccountPanel.h
// =====================================================================
//  The "Account…" dialog for VibePlugin Cloud credits: passwordless sign-in
//  (device code + emailed magic link), credit balance display, the
//  data-collection consent toggles, and a Buy-credits button. Cloud
//  generation runs on the server's keys and is metered against this
//  balance. Network work runs on a background thread and is marshalled
//  back via a SafePointer.
// =====================================================================

#pragma once

#include <juce_gui_extra/juce_gui_extra.h>
#include <thread>
#include <chrono>
#include <atomic>
#include "AppSettings.h"
#include "CloudClient.h"
#include "LicenseClient.h"

class AccountPanel : public juce::Component
{
public:
    AccountPanel()
    {
        baseUrl = vstai::appsettings::cloudBaseUrl();

        titleLabel.setText ("VibePlugin Cloud credits", juce::dontSendNotification);
        titleLabel.setFont (juce::Font (juce::FontOptions (16.0f)));
        titleLabel.setColour (juce::Label::textColourId, juce::Colour (0xff9fb4d8));
        addAndMakeVisible (titleLabel);

        statusLabel.setColour (juce::Label::textColourId, juce::Colours::lightgrey);
        statusLabel.setJustificationType (juce::Justification::topLeft);
        addAndMakeVisible (statusLabel);

        emailLabel.setText ("Email", juce::dontSendNotification);
        emailLabel.setColour (juce::Label::textColourId, juce::Colours::grey);
        emailBox.setTextToShowWhenEmpty ("you@example.com", juce::Colours::grey);
        signInButton.onClick = [this] { doSignIn(); };
        addChildComponent (emailLabel);
        addChildComponent (emailBox);
        addChildComponent (signInButton);

        infoLabel.setColour (juce::Label::textColourId, juce::Colours::white);
        addChildComponent (infoLabel);

        buyButton.onClick     = [this] { doBuy(); };
        refreshButton.onClick = [this] { doRefresh(); };
        signOutButton.onClick = [this] { vstai::appsettings::signOut(); setStatus ("Signed out."); updateState(); notify(); };
        addChildComponent (buyButton);
        addChildComponent (refreshButton);
        addChildComponent (signOutButton);

        historyToggle.setColour (juce::ToggleButton::textColourId, juce::Colours::lightgrey);
        trainToggle.setColour   (juce::ToggleButton::textColourId, juce::Colours::lightgrey);
        historyToggle.onClick = [this] { patchConsent(); };
        trainToggle.onClick   = [this] { patchConsent(); };
        addChildComponent (historyToggle);
        addChildComponent (trainToggle);

        setSize (400, 320);
        updateState();
        if (vstai::appsettings::isSignedIn()) doRefresh();
    }

    // Editor refreshes its own cloud hint when the account state changes.
    std::function<void()> onChanged;

    void resized() override
    {
        auto r = getLocalBounds().reduced (14);
        titleLabel.setBounds (r.removeFromTop (24));
        r.removeFromTop (4);

        if (! vstai::appsettings::isSignedIn())
        {
            emailLabel.setBounds (r.removeFromTop (18));
            emailBox.setBounds   (r.removeFromTop (28));
            r.removeFromTop (8);
            signInButton.setBounds (r.removeFromTop (30).removeFromLeft (220));
        }
        else
        {
            infoLabel.setBounds (r.removeFromTop (24));
            r.removeFromTop (6);
            auto row = r.removeFromTop (30);
            buyButton.setBounds     (row.removeFromLeft (110));
            row.removeFromLeft (6);
            refreshButton.setBounds (row.removeFromLeft (80));
            row.removeFromLeft (6);
            signOutButton.setBounds (row.removeFromLeft (80));
            r.removeFromTop (10);
            historyToggle.setBounds (r.removeFromTop (24));
            trainToggle.setBounds   (r.removeFromTop (24));
        }

        r.removeFromTop (8);
        statusLabel.setBounds (r);
    }

private:
    void setStatus (const juce::String& s) { statusLabel.setText (s, juce::dontSendNotification); }
    void notify() { if (onChanged) onChanged(); }

    void updateState()
    {
        const bool in = vstai::appsettings::isSignedIn();
        emailLabel.setVisible (! in);
        emailBox.setVisible   (! in);
        signInButton.setVisible (! in);
        infoLabel.setVisible (in);
        buyButton.setVisible (in);
        refreshButton.setVisible (in);
        signOutButton.setVisible (in);
        historyToggle.setVisible (in);
        trainToggle.setVisible (in);
        if (in)
            infoLabel.setText (vstai::appsettings::cloudEmail() + "  —  (refreshing…)", juce::dontSendNotification);
        resized();
    }

    void doSignIn()
    {
        const auto email = emailBox.getText().trim().toLowerCase();
        if (! email.containsChar ('@')) { setStatus ("Enter a valid email address."); return; }
        if (signingIn.exchange (true)) return;

        signInButton.setEnabled (false);
        setStatus ("Sending sign-in link…");

        juce::Component::SafePointer<AccountPanel> safe (this);
        const auto base = baseUrl;
        std::thread ([safe, base, email]
        {
            auto s = vstai::cloud::start (base, email);
            if (! s.ok()) { finishSignIn (safe, "Sign-in failed: " + s.error(), false); return; }

            const auto deviceCode = s.json.getProperty ("device_code", {}).toString();
            int interval = (int) s.json.getProperty ("interval", 3);
            if (interval < 1) interval = 3;

            juce::MessageManager::callAsync ([safe]
                { if (safe != nullptr) safe->setStatus ("Check your email and click the link, then wait here…"); });

            for (int i = 0; i < 120; ++i)
            {
                std::this_thread::sleep_for (std::chrono::seconds (interval));
                auto p = vstai::cloud::poll (base, deviceCode);
                if (p.status == 404) { finishSignIn (safe, "Sign-in link expired — try again.", false); return; }
                if (p.ok() && p.json.getProperty ("status", {}).toString() == "approved")
                {
                    vstai::appsettings::signIn (p.json.getProperty ("token", {}).toString(),
                                                p.json.getProperty ("email", {}).toString());
                    finishSignIn (safe, "Signed in.", true);
                    return;
                }
            }
            finishSignIn (safe, "Timed out waiting for the email link.", false);
        }).detach();
    }

    static void finishSignIn (juce::Component::SafePointer<AccountPanel> safe,
                              const juce::String& msg, bool ok)
    {
        juce::MessageManager::callAsync ([safe, msg, ok]
        {
            if (safe == nullptr) return;
            safe->signingIn = false;
            safe->signInButton.setEnabled (true);
            safe->setStatus (msg);
            safe->updateState();
            if (ok) { safe->doRefresh(); safe->notify(); }
        });
    }

    void doRefresh()
    {
        if (! vstai::appsettings::isSignedIn()) return;
        juce::Component::SafePointer<AccountPanel> safe (this);
        const auto base = baseUrl;
        const auto token = vstai::appsettings::cloudToken();
        std::thread ([safe, base, token]
        {
            auto a = vstai::cloud::account (base, token);
            juce::MessageManager::callAsync ([safe, a]
            {
                if (safe == nullptr) return;
                if (a.status == 401)
                {
                    vstai::appsettings::signOut();
                    safe->setStatus ("Session expired — please sign in again.");
                    safe->updateState();
                    safe->notify();
                    return;
                }
                if (! a.ok()) { safe->setStatus ("Could not refresh: " + a.error()); return; }

                const int  credits  = (int)  a.json.getProperty ("credits", 0);
                const bool storeH   = (bool) a.json.getProperty ("store_history", true);
                const bool trainOut = (bool) a.json.getProperty ("train_opt_out", false);

                safe->infoLabel.setText (vstai::appsettings::cloudEmail()
                                         + "   ·   " + juce::String (credits) + " credits",
                                         juce::dontSendNotification);
                safe->setStatus (credits > 0 ? juce::String()
                                             : "Out of credits — Buy credits to generate in the cloud.");
                safe->historyToggle.setToggleState (storeH,   juce::dontSendNotification);
                safe->trainToggle.setToggleState   (trainOut, juce::dontSendNotification);

                // Buying credits includes a lifetime license — claim it on this
                // machine automatically so the nag disappears (best effort).
                const juce::String licKey = a.json.getProperty ("license_key", {}).toString();
                if (licKey.isNotEmpty() && ! vstai::appsettings::isLicensed())
                    safe->claimLicense (licKey);

                safe->notify();
            });
        }).detach();
    }

    // Activate the license bundled with a credit purchase on this machine, in the
    // background. Best effort: if it fails the user can still activate manually
    // from the License… dialog with the key we emailed them.
    void claimLicense (const juce::String& key)
    {
        const auto base    = vstai::appsettings::licenseServerUrl();
        const auto email   = vstai::appsettings::cloudEmail();
        const auto machine = vstai::appsettings::machineId();
        const auto name    = juce::SystemStats::getComputerName();
        juce::Component::SafePointer<AccountPanel> safe (this);
        std::thread ([safe, base, key, email, machine, name]
        {
            auto resp = vstai::license::activate (base, key, email, machine, name);
            if (! resp.ok()) return;
            juce::MessageManager::callAsync ([safe, resp, key, email]
            {
                if (safe == nullptr) return;
                vstai::appsettings::setLicense (key, email,
                    resp.json.getProperty ("activation_id", {}).toString());
                safe->setStatus ("A lifetime license came free with your credits — activated on "
                                 "this machine. The warning is gone. Enjoy!");
                safe->notify();
            });
        }).detach();
    }

    void patchConsent()
    {
        if (! vstai::appsettings::isSignedIn()) return;
        auto* o = new juce::DynamicObject();
        o->setProperty ("store_history", historyToggle.getToggleState());
        o->setProperty ("train_opt_out", trainToggle.getToggleState());
        const juce::var body (o);
        const auto base = baseUrl;
        const auto token = vstai::appsettings::cloudToken();
        std::thread ([base, token, body] { vstai::cloud::patchAccount (base, token, body); }).detach();
    }

    void doBuy()
    {
        juce::String url = vstai::appsettings::cloudCheckoutUrl();
        if (url.isEmpty()) url = vstai::appsettings::cloudBaseUrl();
        const auto email = vstai::appsettings::cloudEmail();
        if (email.isNotEmpty())
            url += (url.containsChar ('?') ? "&" : "?") + juce::String ("checkout[email]=")
                 + juce::URL::addEscapeChars (email, true);
        juce::URL (url).launchInDefaultBrowser();
    }

    juce::String baseUrl;
    std::atomic<bool> signingIn { false };

    juce::Label      titleLabel, statusLabel, emailLabel, infoLabel;
    juce::TextEditor emailBox;
    juce::TextButton signInButton  { "Email me a sign-in link" };
    juce::TextButton buyButton     { "Buy credits" };
    juce::TextButton refreshButton { "Refresh" };
    juce::TextButton signOutButton { "Sign out" };
    juce::ToggleButton historyToggle { "Store my creations on the server (history)" };
    juce::ToggleButton trainToggle   { "Don't use my data for training" };

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (AccountPanel)
};
