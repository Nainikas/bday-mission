# Birthday treasure hunt

A web page that runs in iPhone Safari (no app install). Scanning the QR on the cake opens it; the camera
looks for 5 treasures around the house (any order), shows warmer/colder hints, pops up characters while
you scan, and after all 5 runs an F1 start-lights sequence that reveals 3 Las Vegas Grand Prix tickets.

## Files

| File | What it is |
| --- | --- |
| `index.html` | The hunt itself (what the QR opens) |
| `setup.html` | Organizer page: edit treasures, clues and reveal text, test the scanner, print QR codes |
| `hunt.json` | The hunt data: the 5 treasures built from your photos, clues, hints, ticket text |
| `js/`, `css/`, `vendor/` | Code and bundled libraries |

## Put it online (needed: iPhone cameras only work on https pages)

1. Go to https://app.netlify.com/drop and drag the whole `ar-hunt` folder onto it (free).
2. You get a link like `https://something-random.netlify.app/`. Open `…/setup.html` on your phone.
3. Paste the link in the QR codes box, tap **Make QR codes**, then **Print**. The big one goes on the cake.

Any static host works (GitHub Pages, Cloudflare Pages…). The page downloads its recognition model
(about 25 MB, cached after the first time) from huggingface.co, so open the link once on house Wi‑Fi
before the party.

## Test before the party (important)

On a phone, at the house, open `setup.html`:

1. **Check photos**: flags any treasure whose photos look too much like another one.
2. **Live camera test**: point at each treasure. Its bar should go green (✅). Point at random walls and
   shelves: nothing should go green. Adjust **Sensitivity** if needed.
3. If you changed anything, tap **Download hunt.json**, replace the file in the folder, and drag the folder
   onto Netlify again.
4. **Play the hunt on this device** runs the real thing with your edits, from scratch.

Tips: more close-ups per treasure (2–4 angles, taken in the party's lighting) is the best way to improve
matching. Photos are cropped to their centre square, so keep the object in the middle.

## If the scanner struggles: backup stickers

Print the small QR stickers from the setup page, hide one on each treasure, and tick
"I put backup QR stickers on the treasures" before downloading hunt.json. Scanning a sticker with the
normal iPhone Camera app counts that treasure as found, and the 💡 Hint button tells the birthday
person about the stickers.

## Progress

Progress is saved on the phone, so closing Safari mid-hunt is fine. To restart from zero, open the
link with `?reset=1` at the end.
