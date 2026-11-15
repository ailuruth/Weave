GOAL:    the viewer sees that a word changes shape with the voice, and that a caption can do the same
OUTPUT:  HyperFrames, 1920 x 1080, 30 fps
TIME:    30.2 s x 30 = 906 frames; no music, made to play muted
LOOK:    ground #000000 for whisper and speech, then whole fields of speaker colour (#E5E517 yellow,
         #17E5E5 cyan); ink #FFFFFF on black, #000000 on colour; the accent is the speaker colour and
         appears only as a field or as spoken words;
         display: Roboto Flex on two axes, weight 260 to 1000, width 78% to 151%, set to a fixed
         1728 px line so thin stands 560 px tall and a shout sits 300 px tall, tracking -1%;
         labels: Roboto Flex 400 at 54 px; sentence: Roboto Flex 400 at 190 px;
         no shadow, no grain, no gradient: flat fields and type only
OBJECTS: the word Weave (the hero); one sentence, "You did this"; the Weave mark (white tile,
         black W, from app/icon.svg)
MOTION:  an utterance ripples through the letters 2 frames apart; arrive on expo.out over 14 frames;
         a shout lands on back.out(1.7) over 12 frames; a colour flood is power2.inOut over 12 frames;
         labels blur-swap in 5 frames; a spoken word turns in 4 frames; exits are 5 frames
SHOTS:   0-96     the word thin and tall, "whispered"; it narrows as the film opens
         96-192   said aloud: the letters thicken in a ripple, "spoken"
         192-276  shouted: full weight and width, the ground floods yellow, the ink turns black
         276-360  another voice: the ground floods cyan, the word eases to a softer weight
         360-420  the field drains to black, the word blurs away, a sentence takes its place
         420-714  "You did this" spoken three times, the stress on You, then did, then this;
                  each word turns from grey to yellow as it is said
         714-792  "See how it was said", word by word
         792-906  the mark: the word arrives thin beside its tile and is said once; credit; hold 75
BANNED:  a breathing or looping word; text that moves while it is read; every element fading and
         sliding up; corner labels; three cards; glow; gradients; the logo docked in a corner;
         a black void with small things in the middle (the word fills 90% of the width)
QA:      f0 word thin, label readable; f150 spoken; f240 yellow field, black ink, word inside frame;
         f330 cyan; f520, f620, f700 one stressed word each, line inside frame; f760 claim; f880 mark
