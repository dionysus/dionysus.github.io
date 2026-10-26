window.storyFormat({
    "name": "Harlowe 3 to JSON (blindstack)",
    "version": "0.0.1",
    "author": "dionysus",
    "description": "Convert Harlowe 3-formatted Twine story to JSON",
    "proofing": false,
    "source": `
<html>
	<head>
        <meta http-equiv='Content-Type' content='text/html; charset=UTF-8' />
		<title>BLINDSTACK</title>
        <script type='text/javascript'>
            /**
 * Twine To JSON
 *
 * Copyright (c) 2020 Jonathan Schoonhoven
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
 * associated documentation files (the 'Software'), to deal in the Software without restriction,
 * including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense,
 * and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so,
 * subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all copies or substantial
 * portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT
 * LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
 * IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
 * WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
 * SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */

const STORY_TAG_NAME = "tw-storydata";
const PASSAGE_TAG_NAME = "tw-passagedata";
const FORMAT_TWINE = "twine";
const FORMAT_HARLOWE_3 = "harlowe-3";
const VALID_FORMATS = [FORMAT_TWINE, FORMAT_HARLOWE_3];

const tagKeys = ["speaker", "emotion"];
const speaker_prefix = "speaker:";
const delimiter = ":";
const default_meta = {
  speaker: "",
  emotion: "",
};

/**
 * Resolves the root story name from the DOM safely to avoid parameter drilling.
 */
function getStoryConvoId() {
  const storyElement = document.getElementsByTagName(STORY_TAG_NAME)[0];
  return (storyElement ? storyElement.getAttribute("name") || "default" : "default")
    .toLowerCase()
    .trim();
}

/**
 * Normalizes shorthand IDs into canonical "convoId.key" composite IDs.
 */
function canonicalizeKey(key) {
  if (!key) return "";
  const trimmed = key.trim();
  const convoId = getStoryConvoId();
  return trimmed.includes(".") ? trimmed : convoId + "." + trimmed;
}

/**
 * Convert Twine story to JSON.
 */
function twineToJSON(format) {
  const storyElement = document.getElementsByTagName(STORY_TAG_NAME)[0];
  const storyMeta = getElementAttributes(storyElement);
  const result = {
    uuid: storyMeta.ifid,
    name: storyMeta.name,
    creator: storyMeta.creator,
    creatorVersion: storyMeta["creator-version"],
    schemaName: storyMeta.format,
    schemaVersion: storyMeta["format-version"],
    createdAtMs: Date.now(),
  };

  validate(format);

  const passageElements = Array.from(
    storyElement.getElementsByTagName(PASSAGE_TAG_NAME),
  );

  result.passages = passageElements.map((passageElement) => {
    return processPassageElement(passageElement, format);
  });

  return result;
}

/**
 * Validate story and inputs.
 */
function validate(format) {
  const isValidFormat = VALID_FORMATS.some(
    (validFormat) => validFormat === format,
  );
  if (!isValidFormat) {
    throw new Error("Format is not valid.");
  }
}

function processPassageElement(passageElement, format) {
  const passageMeta = getElementAttributes(passageElement);
  const passageName = (passageMeta.name || "").trim();

  const result = {
    id: passageName,
    convo_key: canonicalizeKey(passageName),
    pid: passageMeta.pid,
  };

  result.meta = parseMetaTags(passageMeta.tags);

  // textContent safely reads nodes even if <tw-storydata> is hidden in the DOM
  const rawContent = passageElement.textContent || passageElement.innerText || "";
  result.text = rawContent.trim();

  Object.assign(result, processPassageText(result.text, format));
  result.cleanText = sanitizeText(
    result.text,
    result.links,
    result.hooks,
    format,
  );

  return result;
}

function processPassageText(passageText, format) {
  const result = { links: [] };
  if (format === FORMAT_HARLOWE_3) {
    result.hooks = [];
  }
  let currentIndex = 0;

  while (currentIndex < passageText.length) {
    const maybeLink = extractLinksAtIndex(passageText, currentIndex);
    if (maybeLink) {
      result.links.push(maybeLink);
      currentIndex += maybeLink.original.length;
      continue; // Jump to end of link token without adding +1
    }

    if (format !== FORMAT_HARLOWE_3) {
      currentIndex += 1;
      continue;
    }

    const maybeLeftHook = extractLeftHooksAtIndex(passageText, currentIndex);
    if (maybeLeftHook) {
      result.hooks.push(maybeLeftHook);
      currentIndex += maybeLeftHook.original.length;
      continue;
    }

    const maybeHook = extractHooksAtIndex(passageText, currentIndex);
    if (maybeHook) {
      result.hooks.push(maybeHook);
      currentIndex += maybeHook.original.length;
      continue;
    }

    currentIndex += 1;
  }

  return result;
}

function extractLinksAtIndex(passageText, currentIndex) {
  const currentChar = passageText[currentIndex];
  const nextChar = passageText[currentIndex + 1];

  if (currentChar === "[" && nextChar === "[") {
    const link = getSubstringBetweenBrackets(passageText, currentIndex + 1);
    const leftSplit = link.split("<-", 2);
    const rightSplit = link.split("->", 2);

    const linkEndIndex = currentIndex + link.length + 4; // After "]]"

    // Parse trailing directive comments (showif, action)
    const directives = parseTrailingDirectives(passageText, linkEndIndex);

    // original covers both the link and all trailing directive comments
    const original = passageText.substring(currentIndex, directives.endIndex);

    let text = "";
    let targetId = "";

    if (leftSplit.length === 2) {
      text = leftSplit[1].trim();
      targetId = leftSplit[0].trim();
    } else if (rightSplit.length === 2) {
      text = rightSplit[0].trim();
      targetId = rightSplit[1].trim();
    } else {
      text = link.trim();
      targetId = link.trim();
    }

    return {
      text: text,
      target_id: canonicalizeKey(targetId),
      show_if: directives.show_if,
      actions: directives.actions,
      original: original,
    };
  }
}

function parseTrailingDirectives(passageText, startIndex) {
  // Matches <!--showif: ...--> or <!--action: ...--> (handles both --> and --!>)
  const directiveRegex = /^\\s*<!--(showif|action):\\s*([\\s\\S]*?)--!?>/i;

  const show_if = [];
  const actions = [];
  let currentIndex = startIndex;

  while (currentIndex < passageText.length) {
    const remainingText = passageText.substring(currentIndex);
    const match = remainingText.match(directiveRegex);
    if (!match) break;

    const directiveType = match[1].toLowerCase();
    const payload = match[2].trim();

    // Supports single entries or comma-separated lists
    const items = payload.split(",").map((s) => s.trim()).filter(Boolean);

    for (const item of items) {
      if (!item.includes(":")) continue;

      let trimmed = item;
      let inverse = false;
      if (trimmed.startsWith("!")) {
        inverse = true;
        trimmed = trimmed.substring(1);
      }

      const [type, value] = trimmed.split(":", 2);
      if (directiveType === "showif") {
        let finalValue = value ? value.trim() : "";

        // Canonicalize local dialogue references into "convoId.passageId"
        const isDialogueCheck = type.toLowerCase().includes("dialog");
        if (isDialogueCheck) {
          finalValue = canonicalizeKey(finalValue);
        }

        show_if.push({
          type: type.trim(),
          value: finalValue,
          inverse: inverse,
        });
      } else if (directiveType === "action") {
        actions.push({
          type: type.trim(),
          value: value ? value.trim() : "",
        });
      }
    }

    currentIndex += match[0].length;
  }

  return {
    show_if: show_if,
    actions: actions,
    endIndex: currentIndex,
  };
}

function extractLeftHooksAtIndex(passageText, currentIndex) {
  const regexAlphaNum = /[a-z0-9]+/i;
  const currentChar = passageText[currentIndex];
  if (currentChar === "|") {
    const maybeHookName = getSubstringBetweenBrackets(
      passageText,
      currentIndex,
      "|",
      ">",
    );
    if (maybeHookName.match(regexAlphaNum)) {
      const hookStartIndex = currentIndex + maybeHookName.length + 2;
      const hookStartChar = passageText[hookStartIndex];
      if (hookStartChar === "[") {
        const hookText = getSubstringBetweenBrackets(
          passageText,
          hookStartIndex,
        );
        const hookEndIndex = hookStartIndex + hookText.length + 2;
        const original = passageText.substring(currentIndex, hookEndIndex);
        return {
          hookName: maybeHookName,
          hookText: hookText,
          original: original,
        };
      }
    }
  }
}

function extractHooksAtIndex(passageText, currentIndex) {
  const regexAlphaNum = /[a-z0-9]+/i;
  const currentChar = passageText[currentIndex];
  const nextChar = passageText[currentIndex + 1];
  const prevChar = currentIndex && passageText[currentIndex - 1];

  if (currentChar === "[" && nextChar !== "[" && prevChar !== "[") {
    const hookText = getSubstringBetweenBrackets(passageText, currentIndex);
    const hookEndIndex = currentIndex + hookText.length + 2;
    const hookEndChar = passageText[hookEndIndex];

    if (hookEndChar === "<") {
      const maybeHookName = getSubstringBetweenBrackets(
        passageText,
        hookEndIndex,
        "<",
        "|",
      );
      if (maybeHookName.match(regexAlphaNum)) {
        const original = passageText.substring(
          currentIndex,
          hookEndIndex + maybeHookName.length + 2,
        );
        return {
          hookName: maybeHookName,
          hookText: hookText,
          original: original,
        };
      }
    }

    const original = passageText.substring(currentIndex, hookText.length + 2);
    return { hookName: undefined, hookText: hookText, original: original };
  }
}

function parseMetaTags(tags) {
  if (!tags || typeof tags !== "string") {
    return {};
  }
  const raw_tags = tags.trim().split(/\\s+/);
  let metadata = {};
  for (const tag of raw_tags) {
    if (!tag.includes(delimiter)) continue;
    let [key, value] = tag.split(delimiter, 2);
    metadata[key] = value;
  }
  return metadata;
}

function sanitizeText(passageText, links, hooks, format) {
  links.forEach((link) => {
    passageText = passageText.replace(link.original, "");
  });
  if (format === FORMAT_HARLOWE_3 && hooks) {
    hooks.forEach((hook) => {
      passageText = passageText.replace(hook.original, "");
    });
  }
  return passageText.trim();
}

function getElementAttributes(element) {
  const result = {};
  if (!element || !element.attributes) return result;

  const attributes = Array.from(element.attributes);
  attributes.forEach((attribute) => {
    result[attribute.name] = attribute.value;
  });

  return result;
}

function stringStartsWith(string, startswith) {
  return string.trim().substring(0, startswith.length) === startswith;
}

function trimPrefix(string, startswith) {
  const trimmed = string.trim();
  if (trimmed.startsWith(startswith)) {
    return trimmed.slice(startswith.length).trim();
  }
  return trimmed;
}

function getSubstringBetweenBrackets(
  string,
  startIndex,
  openBracket,
  closeBracket,
) {
  openBracket = openBracket || "[";
  closeBracket = closeBracket || "]";
  const bracketStack = [];
  let currentIndex = startIndex || 0;
  let substring = "";

  if (string[currentIndex] !== openBracket) {
    throw new Error(
      "startIndex of getSubstringBetweenBrackets must correspond to an open bracket",
    );
  }

  while (currentIndex < string.length) {
    const currentChar = string[currentIndex];

    if (currentChar === closeBracket) {
      bracketStack.pop();
    }

    if (bracketStack.length) {
      substring += currentChar;
    }

    if (currentChar === openBracket) {
      bracketStack.push(currentChar);
    }

    if (!bracketStack.length) {
      return substring;
    }

    currentIndex += 1;
  }

  return substring;
}
        </script>
	</head>
	<body>
        <pre id='content'></pre>
        <div id='storyData' style='display: none;'>{{STORY_DATA}}</div>
        <script type='text/javascript'>document.getElementById('content').innerHTML = JSON.stringify(twineToJSON("harlowe-3"), null, 2);</script>
	</body>
</html>
`
});
