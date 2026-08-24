// AccountPanel.h
// =====================================================================
//  The "Account…" dialog for VibePlugin Cloud credits: passwordless sign-in
//  (device code + emailed magic link), credit balance display, and a
//  Buy-credits button. Nothing is stored on the server for the user, so the
//  dialog carries no data-collection consent toggles. Cloud generation runs
//  on the server's keys and is metered against this balance. Network work
//  runs on a background thread and is marshalled back via a SafePointer.
// =====================================================================

#pragma once

#include <juce_gui_extra/juce_gui_extra.h>
#include <thread>
#include <chrono>
#include <atomic>
#include "AppSettings.h"
#include "CloudClient.h"
#include "Utf8.h"

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

        setSize (400, 260);
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
        if (in)
            infoLabel.setText (vstai::appsettings::cloudEmail() + vstai::u8 ("  —  (refreshing…)"), juce::dontSendNotification);
        resized();
    }

    void doSignIn()
    {
        const auto email = emailBox.getText().trim().toLowerCase();
        if (! email.containsChar ('@')) { setStatus ("Enter a valid email address."); return; }
        if (signingIn.exchange (true)) return;

        signInButton.setEnabled (false);
        setStatus (vstai::u8 ("Sending sign-in link…"));

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
                { if (safe != nullptr) safe->setStatus (vstai::u8 ("Check your email and click the link, then wait here…")); });

            for (int i = 0; i < 120; ++i)
            {
                std::this_thread::sleep_for (std::chrono::seconds (interval));
                auto p = vstai::cloud::poll (base, deviceCode);
                if (p.status == 404) { finishSignIn (safe, vstai::u8 ("Sign-in link expired — try again."), false); return; }
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
                    safe->setStatus (vstai::u8 ("Session expired — please sign in again."));
                    safe->updateState();
                    safe->notify();
                    return;
                }
                if (! a.ok()) { safe->setStatus ("Could not refresh: " + a.error()); return; }

                const int credits = (int) a.json.getProperty ("credits", 0);

                safe->infoLabel.setText (vstai::appsettings::cloudEmail()
                                         + vstai::u8 ("   ·   ") + juce::String (credits) + " credits",
                                         juce::dontSendNotification);
                safe->setStatus (credits > 0 ? juce::String()
                                             : vstai::u8 ("Out of credits — Buy credits to generate in the cloud."));
                safe->notify();
            });
        }).detach();
    }

    void doBuy()
    {
        juce::String url = vstai::appsettings::cloudCheckoutUrl();
        if (url.isEmpty()) url = vstai::appsettings::cloudBaseUrl();
        const auto email = vstai::appsettings::cloudEmail();
        // Polar Checkout Links accept `customer_email` as a plain query param to
        // prefill the buyer's email — no server call needed here. The server's
        // /webhooks/polar handler grants credits to whatever email ends up on
        // the paid order, so this only works if the buyer doesn't edit it away
        // from their signed-in address at checkout.
        if (email.isNotEmpty())
            url += (url.containsChar ('?') ? "&" : "?") + juce::String ("customer_email=")
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

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (AccountPanel)
};
