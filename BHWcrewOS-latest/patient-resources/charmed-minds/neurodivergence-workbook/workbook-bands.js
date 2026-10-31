// Age-band configuration for the Neurodivergence Self-Reflection Workbook app.
// Each band: which forms appear, how rating scales render, and per-band wording overrides.
// Override keys match the answer keys in workbook-data.js. `title`/`sub` replace the form heading.

window.WORKBOOK_BANDS = {

  "0-5": {
    label: "Ages 0–5",
    audience: "Completed by a parent or guardian",
    tone: "proxy",
    note: "Skip anything you are unsure about. Partial answers are still useful.",
    noteLabel: "OPTIONAL",
    purpose: "You know things about your child no assessment can see: how they communicate, what settles them, what tips them over, what they are good at. Write it down once, bring it to every appointment.",
    reassure: "Answer what you know. Leave the rest. Come back later.",
    scale: { max: 2, labels: ["Rarely", "Sometimes", "Often"] },
    forms: ["01", "02", "04", "06", "26", "27"],
    text: {
          "26": {
            "h2": "Things to think about",
                "title": "Home and childcare",
                "sub": "For everyone who cares for them.",
                "f26a": "What works, what does not, what they need to know:"
          },
          "27": {
            "h2": "",
                "title": "One thing to try",
                "sub": "One change, one week.",
                "f27a": "What we tried, what we noticed:"
          },
          "01": {
            "f01c1": "They speak",
            "f01c2": "They write or type",
            "f01c3": "",
            "f01c4": "Pictures or drawing",
            "f01c5": "AAC device",
            "f01c6": "Yes / no choices",
            "f01c7": "I speak for them",
            "f01c8": "Depends on the day:",
            "f01s1": "Know the plan first",
            "f01s2": "One question at a time",
            "f01s3": "Plain words",
            "f01s4": "",
            "f01s5": "More time to answer",
            "f01s6": "",
            "f01s7": "",
            "f01s8": "Breaks",
            "f01s9": "Room to move",
            "f01s10": "",
            "f01s11": "Quieter, dimmer room",
            "f01s12": "Shorter appointment",
                "title": "How your child communicates",
                "sub": "Update it whenever things change.",
                "f01a": "Name used at home, and pronouns",
                "f01c9": "Something else:",
                "f01d": "When they have had enough, it looks like:",
                "f01e": "Best way to approach them:",
                "f01f": "Please do / please do not:",
                "f01g": "Who may join or be told:"
          },
          "02": {
                "title": "Strengths and what they love",
                "sub": "Care should know more than the hard parts.",
                "f02a": "Words your family uses, if any:",
                "f02b": "What they love:",
                "f02c": "Strengths others miss:",
                "f02d": "Where they are most at ease:",
                "f02e": "What you want for them:",
                "f02f": "What not to try to fix:"
          },
          "04": {
                "title": "Sound, light, touch, food",
                "sub": "No correct profile. It changes with the day.",
                "f04m": "Signs it is too much, early and late:",
                "f04n": "What helps in a clinic:",
                "f04o": "Not to be done without asking:"
          },
          "06": {
                "title": "Meltdowns and recovery",
                "sub": "Write this on a calm day.",
                "f06a": "What builds up first:",
                "f06b": "Earliest signs:",
                "f06c": "Later signs:",
                "f06d": "What helps while it is small:",
                "f06e": "During it, please do:",
                "f06f": "During it, please do not:",
                "f06g": "How they show yes, no, stop, help:",
                "f06h": "What makes it worse:",
                "f06i": "What recovery needs, and how long:"
          }
    }
  },

  "6-7": {
    label: "Ages 6–7",
    audience: "For the young person, with a grown-up nearby",
    tone: "young",
    note: "You can skip anything. You can point, draw, or have a grown-up write it for you.",
    noteLabel: "YOU CAN SKIP THIS",
    purpose: "This is about how your brain works, what you are good at, and what you need. No wrong answers.",
    reassure: "Do a bit. Stop. Come back.",
    scale: { max: 2, labels: ["Not much", "Sometimes", "A lot"] },
    forms: ["01", "02", "04", "06", "26", "27"],
    text: {
          "26": {
            "h2": "",
            "p1": "Behaviour is often a message: too much noise, not enough warning, or a skill still growing.",
            "l1": ["What did we notice before it got hard?","What could a grown-up change first?","What should school know?"],
                "title": "School and home",
                "sub": "Do this with a grown-up.",
                "f26a": "Going well / hard / school should know:"
          },
          "27": {
            "h2": "",
            "p1": "Bodies need different things. What calms one person can wind up another.",
            "l1": ["Do I want more input, or less?","What will I try, and when?","Did it help?"],
                "title": "One thing to try",
                "sub": "Try one thing this week.",
                "f27a": "I tried, and what happened:"
          },
          "01": {
            "f01c1": "Talking",
            "f01c2": "Writing",
            "f01c3": "",
            "f01c4": "Drawing",
            "f01c5": "My device",
            "f01c6": "Yes or no",
            "f01c7": "My grown-up helps",
            "f01c8": "Depends:",
            "f01s1": "Tell me the plan",
            "f01s2": "One question at a time",
            "f01s3": "Plain words",
            "f01s4": "",
            "f01s5": "More time",
            "f01s6": "",
            "f01s7": "",
            "f01s8": "Breaks",
            "f01s9": "Something to fidget with",
            "f01s10": "",
            "f01s11": "Quiet and dim",
            "f01s12": "Keep it short",
                "title": "How I like to talk",
                "sub": "So people know before they meet you.",
                "f01a": "My name and pronouns",
                "f01c9": "Something else:",
                "f01d": "When it is too much, I:",
                "f01e": "Check on me by:",
                "f01f": "Please do / please do not:",
                "f01g": "I want with me:"
          },
          "02": {
                "title": "What I am good at",
                "sub": "The good stuff counts.",
                "f02a": "Words I use for my brain:",
                "f02b": "Things I love:",
                "f02c": "Something I am good at:",
                "f02d": "Where I feel most like me:",
                "f02e": "Who I want to be:",
                "f02f": "Do not change this about me:"
          },
          "04": {
                "title": "Sounds, lights, clothes, food",
                "sub": "Every body is different.",
                "f04m": "My body says it is too much by:",
                "f04n": "This room would be easier if:",
                "f04o": "Do not do this to my body:"
          },
          "06": {
                "title": "When it gets too big",
                "sub": "Fill this in on a calm day.",
                "f06a": "Before I get upset:",
                "f06b": "First signs:",
                "f06c": "Later signs:",
                "f06d": "Helps early:",
                "f06e": "Please do:",
                "f06f": "Please do not:",
                "f06g": "I say yes, no, stop, help by:",
                "f06h": "Makes it worse:",
                "f06i": "After, I need:"
          }
    }
  },

  "8-12": {
    label: "Ages 8–12",
    audience: "For the young person",
    tone: "young",
    note: "Skip anything. Talk it, write it, draw it, or have someone write it for you.",
    noteLabel: "YOU CAN SKIP THIS",
    purpose: "You do some things differently from the people around you. This is where you work out how your brain actually works, what you are good at, and what you need, so you can tell people instead of hoping they guess.",
    reassure: "Not meant to be done in one sitting. A page at a time is fine.",
    scale: { max: 4, labels: ["Not at all", "A little", "Sometimes", "A lot", "Always"] },
    forms: ["01", "02", "03", "04", "05", "06", "07", "13", "26", "27"],
    text: {
          "13": {
                "title": "Being kinder to myself",
                "sub": "Learning a harsh message is not your fault.",
                "f13a": "Something I believe about being different:",
                "f13b": "Where it came from:",
                "f13c": "How it protected me:",
                "f13d": "What it costs now:",
                "f13e": "Something kinder and more accurate:",
                "f13f": "What would make that easier:"
          },
          "26": {
            "h2": "Things to think about",
            "p1": "Behaviour often carries a message: overload, no warning, unclear expectations, or a skill still growing.",
            "l1": ["What shows stress is building?","What makes it harder: noise, light, touch, changes, people?","What helps: fewer words, quiet, movement, food, more time?","What can adults change before asking you to cope harder?","What should school know?"],
                "title": "School support",
                "sub": "For you and the adults involved.",
                "f26a": "Working / not working / school should know:"
          },
          "27": {
            "h2": "Things to think about",
            "p1": "Sensory needs are individual and shift by situation. What calms one person can overload another.",
            "l1": ["Am I seeking input, avoiding it, or both?","What does my body need right now?","What will I test, and for how long?","Did it help, do nothing, or make it worse?"],
                "title": "Sensory experiment",
                "sub": "Try one change. Keep what works.",
                "f27a": "What I tried, what I noticed:"
          },
          "01": {
            "f01c3": "On a video call",
            "f01c5": "My AAC device",
            "f01c6": "Yes / no choices",
            "f01c7": "Someone I trust helps",
            "f01c8": "Depends:",
            "f01s1": "Know the plan first",
            "f01s3": "Plain, direct words",
            "f01s5": "More time to answer",
            "f01s6": "Notes afterwards",
            "f01s7": "A timer I can see",
            "f01s9": "Something to fidget with",
            "f01s10": "Camera off",
            "f01s11": "Quieter, dimmer room",
            "f01s12": "Shorter session",
                "title": "How I communicate",
                "sub": "Update it when what you need changes.",
                "f01a": "Name I use, pronouns, words for myself",
                "f01c9": "Something else:",
                "f01d": "When I am overloaded, it looks like:",
                "f01e": "Best way to check in with me:",
                "f01f": "Please do / please do not:",
                "f01g": "Who can be told, and what they do not get:"
          },
          "02": {
                "title": "Strengths and interests",
                "sub": "They should know more than what is hard.",
                "f02a": "Words I use for my brain or identity:",
                "f02b": "What gives me energy:",
                "f02c": "Strengths others miss:",
                "f02d": "Where I feel most like myself:",
                "f02e": "What matters to me:",
                "f02f": "What to appreciate, not change:"
          },
          "03": {
                "title": "What uses me up",
                "sub": "Some things cost more than they look like they should.",
                "f03b": "Early signs I am running out:",
                "f03c": "Signs I need a real break:",
                "f03d": "What actually helps:",
                "f03e": "One thing I could drop or shorten:"
          },
          "04": {
                "title": "Sensory map",
                "sub": "No correct answers. It changes day to day.",
                "f04m": "Signals I notice early, or too late:",
                "f04n": "What would help in this room:",
                "f04o": "My limits with my body:"
          },
          "05": {
                "title": "Where tasks get stuck",
                "sub": "Find the exact moment it gets hard.",
                "f05m": "A task I want easier:",
                "f05n": "What already helps, even a bit:",
                "f05o": "Smallest thing I will try:"
          },
          "06": {
                "title": "Overload and recovery",
                "sub": "Write it while calm. Not about getting in trouble.",
                "f06a": "What piles up first:",
                "f06b": "My early signs:",
                "f06c": "My later signs:",
                "f06d": "Helps before it gets big:",
                "f06e": "When overloaded, please do:",
                "f06f": "Please do not:",
                "f06g": "I say yes, no, stop, help by:",
                "f06h": "Makes it worse:",
                "f06i": "Recovery needs:"
          },
          "07": {
                "title": "Feelings and my body",
                "sub": "Use one recent thing. No right feeling word.",
                "f07a": "What happened, and what had already worn me out:",
                "f07b": "What my body did:",
                "f07c": "Feeling words that might fit:",
                "f07i": "How strong it got",
                "f07d": "What it might have been protecting:",
                "f07e": "What helped, what did not:"
          }
    }
  },

  "13-18": {
    label: "Ages 13–18",
    audience: "For the young person",
    tone: "teen",
    purpose: "You have probably spent a while wondering why things that seem easy for other people are not easy for you, or why you get treated the way you do. This is for working that out on your own terms: how your brain works, what you are actually good at, what you need, and how to say it to people who need to hear it.",
    reassure: "This is not a one-sitting thing. Do a page, leave it, come back. Everything saves on this device.",
    scale: { max: 4, labels: ["Not at all", "A little", "Somewhat", "A lot", "Completely"] },
    forms: ["01","02","03","04","05","06","07","08","09","10","11","12","13","14","15","16","17","18","19","20","23","24","26","27","28","29"],
    text: {
      "01": { sub: "Use this at the start of care and whenever what you need changes." },
      "02": { sub: "The people working with you should know more than what is difficult." },
      "07": { f07i: "How strong it got at the highest point" },
      "09": { f09c: "How certain did this feel?" },
      "12": { f12i: "How much this matters to me right now", f12k: "How confident I am with the right support" },
      "16": {
        title: "Session reflection and review",
        sub: "Your feedback is information they need. It is fine to say this is confusing or not helping.",
        f16a: "I felt understood today",
        f16b: "The pace and format worked for me",
        f16c: "Today felt connected to what I want"
      },
      "20": {
        title: "Family, caregivers, and my own say",
        sub: "Support and autonomy are not opposites. This is where you set the balance."
      },
      "26": {
        title: "School support and co-regulation",
        sub: "For you and the adults involved."
      }
    }
  },

  "19-29": {
    label: "Ages 19–29",
    audience: "Adult",
    tone: "adult",
    purpose: "Much of this decade is spent building a life on someone else's template — work, study, independence, relationships — and discovering the template does not fit. This workbook is for mapping how you actually function, so you can build around it rather than apologise for it.",
    reassure: "Not designed to be completed in one sitting. Answers save on this device and wait for you.",
    scale: { max: 10 },
    forms: ["01","02","03","04","05","06","07","08","09","10","11","12","13","14","15","16","17","18","19","20","21","22","23","24","25","27","28","29"],
    text: {}
  },

  "30-54": {
    label: "Ages 30–54",
    audience: "Adult",
    tone: "adult",
    purpose: "By now you have a long record of what works and what quietly costs you. Often alongside work, caregiving, and a diagnosis that came late or has not come at all. This workbook is for making that record explicit — what drains you, what restores you, and what needs to change.",
    reassure: "Not designed to be completed in one sitting. Answers save on this device and wait for you.",
    scale: { max: 10 },
    forms: ["01","02","03","04","05","06","07","08","09","10","11","12","13","14","15","16","17","18","19","20","21","22","23","24","25","27","28","29"],
    text: {}
  },

  "55+": {
    label: "Ages 55+",
    audience: "Adult",
    tone: "adult",
    purpose: "Many people arrive here having spent decades without a name for how their brain works, and with a lifetime of adaptations built by trial and error. This workbook is for setting down what you already know about yourself, and deciding what still needs to change.",
    reassure: "Not designed to be completed in one sitting. Answers save on this device and wait for you.",
    scale: { max: 10 },
    forms: ["01","02","03","04","05","06","07","08","09","10","11","12","13","14","15","16","17","18","19","20","21","22","23","24","25","27","28","29"],
    text: {}
  }
};
