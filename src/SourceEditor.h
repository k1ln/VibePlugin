// SourceEditor.h
// =====================================================================
//  A small CodeEditorComponent with its own CodeDocument, a dark colour
//  scheme that matches the plugin, and a Cmd/Ctrl+S hook ("save = compile").
//
//  CodeDocument is a *private base* so it is constructed before the
//  CodeEditorComponent base — which stores a reference to it — sidestepping
//  the member-init-order trap of holding the document as a normal member.
// =====================================================================

#pragma once

#include <juce_gui_extra/juce_gui_extra.h>
#include <functional>

class SourceEditor : private juce::CodeDocument,
                     public  juce::CodeEditorComponent
{
public:
    explicit SourceEditor (juce::CodeTokeniser* tokeniser)
        : juce::CodeEditorComponent (static_cast<juce::CodeDocument&> (*this), tokeniser)
    {
        applyDarkScheme();
    }

    std::function<void()> onSave;   // fired on Cmd/Ctrl+S

    juce::String getText() const            { return juce::CodeDocument::getAllContent(); }
    void setText (const juce::String& text) { loadContent (text); }   // resets undo/caret

    bool keyPressed (const juce::KeyPress& key) override
    {
        if (key == juce::KeyPress ('s', juce::ModifierKeys::commandModifier, 0)
         || key == juce::KeyPress ('s', juce::ModifierKeys::ctrlModifier, 0))
        {
            if (onSave) onSave();
            return true;
        }
        return juce::CodeEditorComponent::keyPressed (key);
    }

private:
    void applyDarkScheme()
    {
        setColour (juce::CodeEditorComponent::backgroundColourId,      juce::Colour (0xff0c0f16));
        setColour (juce::CodeEditorComponent::defaultTextColourId,     juce::Colour (0xffe7ecf4));
        setColour (juce::CodeEditorComponent::lineNumberBackgroundId,  juce::Colour (0xff141a24));
        setColour (juce::CodeEditorComponent::lineNumberTextId,        juce::Colour (0xff6c7a93));
        setColour (juce::CodeEditorComponent::highlightColourId,       juce::Colour (0xff2a3a5a));

        juce::CodeEditorComponent::ColourScheme scheme;
        scheme.set ("Error",             juce::Colour (0xffff5577));
        scheme.set ("Comment",           juce::Colour (0xff6c7a93));
        scheme.set ("Keyword",           juce::Colour (0xff5b8cff));
        scheme.set ("Operator",          juce::Colour (0xffc4d2ea));
        scheme.set ("Identifier",        juce::Colour (0xffe7ecf4));
        scheme.set ("Integer",           juce::Colour (0xffffb86c));
        scheme.set ("Float",             juce::Colour (0xffffb86c));
        scheme.set ("String",            juce::Colour (0xff8ad17a));
        scheme.set ("Bracket",           juce::Colour (0xffc4d2ea));
        scheme.set ("Punctuation",       juce::Colour (0xffc4d2ea));
        scheme.set ("Preprocessor Text", juce::Colour (0xffbb88ff));
        setColourScheme (scheme);

        setScrollbarThickness (10);
        setFont (juce::Font (juce::FontOptions()
                                 .withName (juce::Font::getDefaultMonospacedFontName())
                                 .withHeight (14.0f)));
    }
};
