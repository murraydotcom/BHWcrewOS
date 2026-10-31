// Tap-to-pick answer options for the young bands.
// Shape: WORKBOOK_CHOICES[bandId][formNum][answerKey] = [[symbol, phrase], ...]
// A prompt listed here renders as chips instead of a typing field. Anything not listed stays a text field.
// Selections are stored as an array of phrases, so several can be picked.

window.WORKBOOK_CHOICES = {

  "6-7": {
    "01": {
      f01d: [
        ["\uD83E\uDD10", "Go quiet"], ["\uD83D\uDE41", "Look upset"], ["\uD83D\uDE4C", "Cover my ears"],
        ["\uD83D\uDC40", "Look away"], ["\uD83C\uDFC3", "Move around a lot"], ["\uD83D\uDEAA", "Want to leave"],
        ["\uD83E\uDD7A", "Ask for help"], ["\uD83D\uDE24", "Get cross"], ["\uD83D\uDE2D", "Cry"]
      ],
      f01e: [
        ["\uD83D\uDDE3\uFE0F", "Just ask me"], ["\uD83D\uDC4D", "Thumbs up or down"], ["\uD83D\uDDBC\uFE0F", "Show me pictures"],
        ["\u23F3", "Wait a bit first"], ["\uD83D\uDC69", "Ask my grown-up"], ["\u270F\uFE0F", "Let me draw it"]
      ],
      f01f: [
        ["\uD83D\uDD08", "Talk quietly"], ["\u2753", "One question at a time"], ["\uD83D\uDEAB", "Do not rush me"],
        ["\uD83D\uDE4B", "Do not touch me"], ["\uD83E\uDDF8", "Let me hold something"], ["\uD83D\uDEB6", "Let me stand up"],
        ["\uD83D\uDCA1", "Turn the lights down"], ["\uD83D\uDE0A", "Tell me what happens next"]
      ],
      f01g: [
        ["\uD83D\uDC69", "Mum"], ["\uD83D\uDC68", "Dad"], ["\uD83D\uDC75", "Grandparent"],
        ["\uD83D\uDC6B", "Carer"], ["\uD83D\uDC67", "Brother or sister"], ["\uD83D\uDE4B", "Nobody, just me"]
      ]
    },
    "02": {
      f02b: [
        ["\uD83D\uDC15", "Animals"], ["\uD83D\uDE82", "Trains and cars"], ["\uD83C\uDFAE", "Games"],
        ["\uD83C\uDFA8", "Drawing"], ["\uD83C\uDFB5", "Music"], ["\uD83D\uDCDA", "Books"],
        ["\u26BD", "Running and sport"], ["\uD83E\uDDF1", "Building things"], ["\uD83C\uDF33", "Being outside"],
        ["\uD83D\uDCFA", "A show I love"], ["\uD83D\uDD22", "Numbers"], ["\uD83D\uDC96", "One special person"]
      ],
      f02c: [
        ["\uD83E\uDDE0", "Remembering things"], ["\uD83D\uDD0D", "Noticing details"], ["\uD83D\uDCAA", "Not giving up"],
        ["\uD83E\uDD1D", "Being kind"], ["\uD83D\uDE04", "Making people laugh"], ["\uD83D\uDCA1", "Good ideas"],
        ["\uD83C\uDFC3", "Being fast"], ["\uD83E\uDDE9", "Working things out"], ["\u2764\uFE0F", "Caring about animals"]
      ],
      f02d: [
        ["\uD83C\uDFE0", "At home"], ["\uD83D\uDECF\uFE0F", "In my room"], ["\uD83C\uDF33", "Outside"],
        ["\uD83D\uDC15", "With my pet"], ["\uD83D\uDC6A", "With my family"], ["\uD83D\uDC6F", "With one friend"],
        ["\uD83E\uDD17", "On my own"], ["\uD83C\uDFEB", "At school"]
      ],
      f02f: [
        ["\uD83D\uDDE3\uFE0F", "How I talk"], ["\uD83C\uDFC3", "How much I move"], ["\uD83D\uDD0A", "How loud I am"],
        ["\uD83E\uDDE9", "The things I love"], ["\uD83E\uDD1A", "Needing quiet"], ["\uD83D\uDD04", "Liking things the same"]
      ]
    },
    "04": {
      f04m: [
        ["\uD83E\uDEC0", "My heart goes fast"], ["\uD83E\uDD75", "I get hot"], ["\uD83E\uDD22", "My tummy hurts"],
        ["\uD83D\uDE35", "My head hurts"], ["\uD83D\uDE2C", "I go tight"], ["\uD83D\uDE13", "I want to hide"],
        ["\uD83D\uDE44", "I cannot listen"], ["\uD83D\uDE2F", "I want to shout"]
      ],
      f04n: [
        ["\uD83D\uDD07", "Less noise"], ["\uD83D\uDCA1", "Dimmer lights"], ["\uD83E\uDDE3", "Headphones"],
        ["\uD83E\uDDF8", "Something to hold"], ["\uD83E\uDE91", "A chair I like"], ["\uD83D\uDEB6", "Room to move"],
        ["\uD83D\uDEAA", "Fewer people"], ["\u23F1\uFE0F", "Shorter time"]
      ],
      f04o: [
        ["\uD83D\uDE4B", "Do not touch my head"], ["\uD83E\uDD1A", "Do not hug me"], ["\u270B", "Do not hold my hand"],
        ["\uD83D\uDC5F", "Do not take my shoes off"], ["\uD83D\uDC55", "Do not change my clothes"], ["\uD83D\uDC4D", "Ask me first"]
      ]
    },
    "06": {
      f06a: [
        ["\uD83D\uDE34", "I am tired"], ["\uD83C\uDF7D\uFE0F", "I am hungry"], ["\uD83D\uDD0A", "It is too loud"],
        ["\uD83D\uDC65", "Too many people"], ["\uD83D\uDD04", "Plans changed"], ["\u23F3", "Waiting too long"],
        ["\uD83D\uDE15", "I do not know what is happening"], ["\uD83D\uDCDD", "Too much work"]
      ],
      f06b: [
        ["\uD83E\uDD10", "I go quiet"], ["\uD83D\uDE2C", "I fidget more"], ["\uD83D\uDE41", "My face changes"],
        ["\uD83D\uDE4C", "I cover my ears"], ["\uD83D\uDE13", "I feel wobbly"], ["\uD83D\uDDE3\uFE0F", "I talk faster"]
      ],
      f06c: [
        ["\uD83D\uDE2D", "I cry"], ["\uD83D\uDE24", "I shout"], ["\uD83E\uDD10", "I stop talking"],
        ["\uD83C\uDFC3", "I run off"], ["\uD83D\uDECF\uFE0F", "I lie down"], ["\uD83D\uDE33", "I cannot think"]
      ],
      f06d: [
        ["\uD83D\uDEAA", "Go somewhere quiet"], ["\uD83D\uDCA7", "A drink"], ["\uD83C\uDF4E", "A snack"],
        ["\uD83E\uDDF8", "My comfort thing"], ["\uD83E\uDEC2", "A big squeeze"], ["\uD83D\uDEB6", "Move my body"],
        ["\uD83D\uDCDA", "Something I like"], ["\u23F1\uFE0F", "A short break"]
      ],
      f06e: [
        ["\uD83E\uDD2B", "Stay quiet"], ["\uD83D\uDECB\uFE0F", "Sit near me"], ["\uD83D\uDD07", "Turn things off"],
        ["\uD83D\uDEAA", "Take me out of the room"], ["\u23F3", "Give me time"], ["\uD83E\uDDF8", "Bring my thing"]
      ],
      f06f: [
        ["\uD83D\uDDE3\uFE0F", "Do not keep talking"], ["\u2753", "Do not ask lots of questions"], ["\uD83D\uDE4B", "Do not touch me"],
        ["\uD83D\uDE20", "Do not get cross"], ["\uD83D\uDC65", "Do not bring more people"], ["\uD83D\uDCF8", "Do not watch me"]
      ],
      f06g: [
        ["\uD83D\uDC4D", "Thumbs up for yes"], ["\uD83D\uDC4E", "Thumbs down for no"], ["\u270B", "Hand up for stop"],
        ["\uD83D\uDDBC\uFE0F", "Point at a picture"], ["\uD83D\uDEAA", "Walk to the door"], ["\uD83D\uDCF1", "Use my device"]
      ],
      f06h: [
        ["\uD83D\uDD0A", "More noise"], ["\uD83D\uDCA1", "Bright lights"], ["\uD83D\uDDE3\uFE0F", "Being told off"],
        ["\uD83E\uDD1A", "Being touched"], ["\u23F3", "Being hurried"], ["\uD83D\uDC65", "More people"]
      ],
      f06i: [
        ["\uD83E\uDD2B", "Quiet time"], ["\uD83D\uDECF\uFE0F", "A rest"], ["\uD83D\uDC15", "My pet"],
        ["\uD83E\uDDF8", "My comfort thing"], ["\uD83D\uDCFA", "Something easy to watch"], ["\uD83D\uDC96", "A cuddle if I ask"],
        ["\uD83D\uDDE3\uFE0F", "Not talking about it yet"]
      ]
    }
  },

  "8-12": {
    "01": {
      f01d: [
        ["\uD83E\uDD10", "I go quiet"], ["\uD83D\uDE44", "I stop taking things in"], ["\uD83D\uDE2C", "I fidget more"],
        ["\uD83D\uDEAA", "I want to leave"], ["\uD83D\uDE24", "I get short with people"], ["\uD83D\uDE13", "I look fine but I am not"],
        ["\uD83E\uDDCA", "I freeze"], ["\uD83D\uDE2D", "I get tearful"]
      ],
      f01e: [
        ["\uD83D\uDDE3\uFE0F", "Ask me straight out"], ["\uD83D\uDC4D", "Let me signal instead of talk"], ["\u23F3", "Give me a minute first"],
        ["\uD83D\uDCDD", "Ask in writing"], ["\uD83E\uDD1D", "Ask when we are side by side"], ["\uD83D\uDEAB", "Do not ask in front of others"]
      ]
    },
    "04": {
      f04m: [
        ["\uD83E\uDEC0", "Heart speeding up"], ["\uD83E\uDD75", "Getting hot"], ["\uD83E\uDD22", "Stomach ache"],
        ["\uD83D\uDE35", "Headache"], ["\uD83D\uDE2C", "Jaw or shoulders tight"], ["\uD83D\uDE34", "Suddenly exhausted"],
        ["\uD83D\uDE44", "Sounds get sharper"], ["\uD83D\uDE33", "Words stop making sense"], ["\u2753", "I notice none of it until later"]
      ]
    },
    "06": {
      f06b: [
        ["\uD83E\uDD10", "Going quiet"], ["\uD83D\uDE2C", "Moving more"], ["\uD83D\uDE41", "Everything annoys me"],
        ["\uD83D\uDE44", "Losing track of what people say"], ["\uD83E\uDD75", "Feeling hot"], ["\uD83D\uDEAA", "Wanting out"]
      ],
      f06e: [
        ["\uD83E\uDD2B", "Stop talking to me"], ["\uD83D\uDD07", "Cut the noise and light"], ["\uD83D\uDEAA", "Get me out of the room"],
        ["\uD83D\uDECB\uFE0F", "Stay nearby without talking"], ["\u23F3", "Wait it out with me"], ["\uD83D\uDCA7", "Bring water"]
      ],
      f06f: [
        ["\u2753", "Do not ask me questions"], ["\uD83D\uDE20", "Do not tell me off"], ["\uD83E\uDD1A", "Do not touch me"],
        ["\uD83D\uDCF8", "Do not let people watch"], ["\u23F1\uFE0F", "Do not rush me back"], ["\uD83D\uDDE3\uFE0F", "Do not explain it yet"]
      ]
    },
    "07": {
      f07c: [
        ["\uD83D\uDE21", "Angry"], ["\uD83D\uDE1F", "Worried"], ["\uD83D\uDE22", "Sad"], ["\uD83D\uDE28", "Scared"],
        ["\uD83D\uDE35", "Overloaded"], ["\uD83D\uDE33", "Embarrassed"], ["\uD83D\uDE12", "Frustrated"], ["\uD83E\uDEE5", "Left out"],
        ["\uD83D\uDE14", "Let down"], ["\uD83E\uDD75", "Wound up"], ["\uD83D\uDE2A", "Flat and tired"], ["\u2753", "Not sure"]
      ],
      f07b: [
        ["\uD83E\uDEC0", "Heart racing"], ["\uD83E\uDD22", "Sick feeling"], ["\uD83D\uDE2C", "Tight muscles"],
        ["\uD83C\uDF00", "Head spinning"], ["\uD83C\uDFC3", "Needed to move"], ["\uD83D\uDEAA", "Needed to get away"],
        ["\uD83E\uDD10", "Could not speak"], ["\uD83D\uDD0A", "Noise got too loud"]
      ]
    },
    "13": {
      f13a: [
        ["\uD83D\uDE10", "I am too much"], ["\uD83D\uDE36", "I am not trying hard enough"], ["\uD83E\uDD1A", "Needing help is weak"],
        ["\uD83C\uDFAD", "I should act normal"], ["\uD83E\uDD10", "My feelings are a problem"], ["\u23F1\uFE0F", "I am too slow"],
        ["\uD83D\uDE41", "I am hard to like"]
      ]
    }
  }
};
