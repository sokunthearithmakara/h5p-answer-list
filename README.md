# H5P Answer List

An H5P question type where learners build a list of free-text answers, one item at a time. Each item is checked against a pool of acceptable answers.

**Example tasks**
- Identify 10 countable nouns in a paragraph.
- List 5 mistakes the speaker makes in a video or audio clip.
- Name at least two stages of the water cycle.

## Features

### For learners
- Type an answer and press **Enter** (or the **+** button) to add it to the list. Each item shows as a chip with a remove (×) button.
- Empty and duplicate entries are rejected with an inline message. When the list is full, the answer field says so and re-enables as soon as an item is removed.
- **Check** marks each item correct (green ✓) or incorrect (red ✗) and shows the score, a correct/incorrect summary and the overall feedback.
- **Show solution** lists the acceptable answers the learner didn't find.
- Optional **highlighting in the supporting text**: after Check, correct answers are highlighted green and incorrect answers that appear in the text red. Show solution adds the missed answers in yellow. Each highlight has a tooltip, so the meaning isn't colour only.
- **Retry** clears the whole list. **Retry incorrect** removes only the wrong items and keeps the correct ones.
- Optional **instant feedback** marks each item as soon as it's added.
- Optional **sound effects**: short tones when an item is added or removed, for each item with instant feedback, and on Check (one for a perfect score, another otherwise). The tones are generated in the browser, so no audio files are needed, and the task works normally if sound isn't available.
- Progress is saved and restored when the learner comes back (resume state).

### For authors
- Optional image, video or audio, shown below the task description, and optional supporting text (e.g. the passage to search).
- **Acceptable answers** in one textarea: one answer per line, with alternatives separated by `|`:
  ```
  bike | bicycle
  evaporation | evaporate
  precipitation | rain | snow
  ```
  Each line can be matched only once, so `bike` and `bicycle` together count as one correct item.
- **Maximum number of items** the learner can add.
- **Correct items needed for full score**, which is also the maximum score. Use it for "name at least two" tasks: 4 items allowed, 2 needed.
- **Penalty** per incorrect item, e.g. 0.5 points. The score never goes below 0:
  `score = max(0, min(correct, required) − penalty × incorrect)`
- **Matching options:** case sensitivity, accepting minor spelling and spacing errors, and ignoring leading articles (the word list is editable).
  - Spelling tolerance uses H5P.TextUtilities. It also ignores spacing, so in languages where spaces are optional, such as Khmer, "សេចក្ដី ជូន ដំណឹង" matches "សេចក្ដីជូនដំណឹង".
  - Surrounding punctuation (including the Khmer ។ and ៕) and invisible characters such as zero-width spaces are always ignored.
- **Behaviour options:** instant feedback, Show solution, Retry, Retry incorrect, highlighting answers in the supporting text, sound effects, requiring a full list before checking, and two copy-and-paste deterrents:
  - *Prevent copying the task text*: learners can't select, copy or right-click the task description and supporting text.
  - *Prevent pasting into the answer field*: blocks keyboard paste, the right-click menu, drag and drop, and mobile clipboard insertion.

  These are deterrents only; a determined learner can still get around them.
- **Highlighting** finds every alternative of each answer in the supporting text. In languages written with spaces it matches whole words only ("bag" doesn't match inside "baggage"). It never splits a character cluster, so in Khmer "ត្រី" doesn't match inside "ស្ត្រី". Khmer compound words can still contain a matching term.
- Overall feedback per score range, and every learner-facing string (buttons, messages, screen-reader labels) is translatable. Special characters in translations, such as apostrophes, display correctly.

### Reporting (xAPI)
- `interacted` when an item is added or removed.
- `answered` on Check, with:
  - `interactionType: fill-in` and the learner's items joined by `[,]` as the response.
  - A `{case_matters=…}{order_matters=false}` correct-response pattern.
  - The full alternatives list in the `https://h5p.org/x-api/alternatives` extension.
  - Per-item correctness in the `https://h5p.org/x-api/answer-list/items` result extension.
- Implements the H5P question contract (`getScore`, `getMaxScore`, `getAnswerGiven`, `showSolutions`, `resetTask`, `getXAPIData`, `getCurrentState`), so it works inside containers such as Question Set, Interactive Video and Course Presentation.

### Accessibility
- The answer field, add button and remove buttons all work from the keyboard.
- Additions, removals and results are announced to screen readers, and correct/incorrect is conveyed with icons and text as well as colour.

## Compatibility
- **H5P core 1.28+:** uses the new H5P theme and follows the platform's theme colours.
- **Older cores:** tested on core 1.27 (as used by Lumi). There are no theme variables there, so Answer List falls back to the classic H5P.Question look. It also works around two display bugs in the older H5P.Question and H5P.Video releases: expanded images overlapping the text, and a gap above YouTube videos.

## Exporting .h5p packages
Use the export tool rather than the h5p-cli dashboard's Export button. Run it from an [h5p-cli](https://github.com/h5p/h5p-cli) workspace (the folder with `libraries/` and `content/`):

```bash
node libraries/H5P.AnswerList-1.0/tools/export-legacy.js <content-folder> [coreMinor=27] [--slim] [--exclude=Name,...] [--include=Name,...]
```

It writes `temp/<content-folder>-core1.<coreMinor>[-slim].h5p`.

### Older platforms
The latest H5P.Question, JoubelUI and Components releases require core 1.28. An older platform rejects a package that contains them, with an error like:

```
api-version-unsupported (component: H5P.Components-1.0, current: 1.27, required: 1.28)
```

For each dependency, the tool picks the newest release that the target core (`coreMinor`, default 27) accepts and that needs no build step, taken from that library's git history. Use `28` for current platforms.

### Smaller packages
H5P accepts a package that leaves out a library, as long as that library is already installed on the site. `--slim` leaves out libraries that every H5P site has: FontAwesome, jQuery.ui, H5P.Question, JoubelUI, Transition, FontIcons, TextUtilities, Image, Video, Audio, and the RangeList, ShowWhen and TableList editor widgets. The package then holds just Answer List and the content.

| Nouns sample | Size |
|---|---|
| h5p-cli dashboard Export | 5,821 KB |
| Export tool | 835 KB |
| Export tool with `--slim` | 15 KB |

If a site is missing one of the left-out libraries, the import fails with *Missing required library*. Put that library back with `--include=Name`, or leave out more with `--exclude=Name`. H5P.Components is never left out automatically, because sites set up before 2025 don't have it.

### Other notes
- Files listed in a library's `.h5pignore` (such as `tools/`) are left out of the package.
- When you update an installed copy, bump `patchVersion` in `library.json`. H5P only replaces a library when the package contains a higher patch version.

## Development
Plain JavaScript and CSS, with no build step.

1. Install [h5p-cli](https://github.com/h5p/h5p-cli) and set up a workspace with the core libraries and this library's dependencies: H5P.Question 1.5 (which brings H5P.JoubelUI and H5P.Components), H5P.TextUtilities 1.3, FontAwesome 4.5, plus the editor widgets H5PEditor.RangeList and H5PEditor.ShowWhen.
2. Clone this repository into the workspace as `libraries/H5P.AnswerList-1.0`.
3. Run `h5p server`, then create content from the dashboard.

| Path | Purpose |
|---|---|
| `js/answer-list.js` | The question type (extends H5P.Question) |
| `js/matcher.js` | Answer normalisation and matching |
| `css/answer-list.css` | Styles, using H5P theme variables with fallbacks |
| `semantics.json` | Editor form definition |
| `language/.en.json` | English source strings for translations |
| `tools/export-legacy.js` | Export tool: older cores, slim packages (not packed into .h5p files) |

## License
[MIT](LICENSE)
