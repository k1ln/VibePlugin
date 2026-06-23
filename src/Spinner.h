// Spinner.h — a small indeterminate "busy" spinner (12 fading spokes).
#pragma once

#include <juce_gui_basics/juce_gui_basics.h>
#include <cmath>

class Spinner : public juce::Component, private juce::Timer
{
public:
    Spinner() { setInterceptsMouseClicks (false, false); }

    void setActive (bool shouldBeActive)
    {
        active = shouldBeActive;
        setVisible (active);
        if (active) startTimerHz (30);
        else        stopTimer();
        repaint();
    }

    void paint (juce::Graphics& g) override
    {
        if (! active) return;
        auto b      = getLocalBounds().toFloat();
        auto centre = b.getCentre();
        auto radius = juce::jmin (b.getWidth(), b.getHeight()) * 0.5f - 1.5f;
        if (radius <= 1.0f) return;

        constexpr int n = 12;
        for (int i = 0; i < n; ++i)
        {
            const float angle = juce::MathConstants<float>::twoPi * (float) i / (float) n;
            // the leading spoke is brightest, the rest trail off
            const float t = std::fmod ((float) i - phase + (float) n, (float) n) / (float) n;
            g.setColour (juce::Colours::white.withAlpha (0.12f + 0.78f * t));
            auto p1 = centre.getPointOnCircumference (radius * 0.5f, angle);
            auto p2 = centre.getPointOnCircumference (radius,        angle);
            g.drawLine (p1.x, p1.y, p2.x, p2.y, 2.0f);
        }
    }

private:
    void timerCallback() override
    {
        phase += 1.0f;
        if (phase >= 12.0f) phase -= 12.0f;
        repaint();
    }

    bool  active = false;
    float phase  = 0.0f;
};
