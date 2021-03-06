import { parse } from "https://deno.land/std@0.138.0/encoding/yaml.ts";
import { serve } from "https://deno.land/x/sift@0.5.0/mod.ts";
import "https://deno.land/x/dotenv@v3.2.0/load.ts";
import "https://raw.githubusercontent.com/rycont/josa-complete/master/src/index.ts";

interface Concept {
  label: string;
  description?: string;
  subconcepts?: Concept[];
  validQuestions?: string[];
}

interface FlatConcept extends Omit<Concept, "subconcepts"> {
  subconcepts?: string[];
  path: string[];
}

function labelParser(label: string) {
  const sanitized = label.replaceAll("\\", "");
  if (sanitized.includes("[")) {
    const header = sanitized.split("[")[1].split("]")[0].trim();
    const [label, spec] = header.split("|").map((e) => e.trim());
    return {
      label,
      description: sanitized.split("]")[1].trim(),
      validQuestions: spec?.split(",").map((e) => e.trim()),
    };
  }

  return { label: sanitized };
}

type YamlBlock = {
  [key: string]: (string | YamlBlock)[];
};

function yaml2concept(yaml: YamlBlock | string) {
  if (typeof yaml === "string") return labelParser(yaml);

  let [key, contents] = Object.entries(yaml)[0];

  if (!contents.map) {
    contents = [contents as unknown as string];
  }

  const concept: Concept = {
    ...labelParser(key),
    subconcepts: contents.map((content) => {
      if (typeof content === "string") {
        return labelParser(content) as Concept;
      }

      return yaml2concept(content as YamlBlock);
    }),
  };

  return concept;
}

function flattenConcepts(concept: Concept, path: string[]): FlatConcept[] {
  if (concept.subconcepts) {
    return [
      {
        label: concept.label,
        description: concept.description,
        subconcepts: concept.subconcepts.map((e) => e.label),
        validQuestions: concept.validQuestions,
        path,
      },
      ...concept.subconcepts.flatMap((e) =>
        flattenConcepts(e, [...path, concept.label])
      ),
    ];
  }

  if (!concept.description) return [];

  return [
    {
      label: concept.label,
      description: concept.description,
      path,
      validQuestions: concept.validQuestions,
    },
  ];
}

async function getPagesInCollection(collectionId: string) {
  const response = await (
    await fetch("https://outline.rycont.ninja/api/collections.info", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: "Bearer YOoY7txAZr8mCQ56v1kLiIFxz4a4b55a6hIDfO",
      },
      body: JSON.stringify({
        id: collectionId,
      }),
    })
  ).json();

  return response.data.documents.map((e: { id: string }) => e.id);
}

async function getPageContent(pageId: string) {
  const response = await (
    await fetch("https://outline.rycont.ninja/api/documents.info", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: "Bearer YOoY7txAZr8mCQ56v1kLiIFxz4a4b55a6hIDfO",
      },
      body: JSON.stringify({
        id: pageId,
      }),
    })
  ).json();

  let text = (response.data.text as string)
    .trim()
    .replaceAll("* ", "- ")
    .replaceAll("\n\n", "\n");

  if (text[text.length - 1] === "\\") text = text.slice(0, -1);

  text = text
    .split("\n")
    .filter((e) => e.trim().length)
    .map((line, index, document) => {
      if (document.length - 1 === index) return line;
      if (
        document[index + 1].indexOf(document[index + 1].trim()[0]) >
        line.indexOf(line.trim()[0])
      ) {
        return line + ":";
      }
      return line;
    })
    .join("\n");

  return { text, pageTitle: response.data.title };
}

const concatHigherLevelConceptLabel = (label: string, path: string[]) => {
  if (!label.startsWith("#")) return label;

  return path[path.length - 1] + "??? " + label.slice(1).trim();
};

const questionTemplates: {
  [key: string]: (topic: FlatConcept) => {
    text: string;
    additionalInfo?: string;
    answer: string;
  } | null;
} = {
  ??????(topic: FlatConcept) {
    return {
      text: `"${concatHigherLevelConceptLabel(
        topic.label,
        topic.path
      )}"??? ????????? ??????????????????`,
      answer:
        topic.description ||
        (topic.subconcepts && topic.subconcepts.join(", ")) ||
        "????????? ????????????",
    };
  },
  ??????(topic: FlatConcept) {
    if (!topic.description) return null;
    return {
      text:
        `?????? ????????? ????????? ????????? ????????????????` +
        (topic.path.length && !topic.label.startsWith("#")
          ? ` (${topic.path[topic.path.length - 1]})`
          : ""),
      additionalInfo: topic.description,
      answer: concatHigherLevelConceptLabel(topic.label, topic.path),
    };
  },
  // ??????(topic) {
  //   return {
  //     text: `"${topic.label}"??? ????????? ?????? ???????????????`,
  //     answer: topic.description ||
  //       (topic.subconcepts && topic.subconcepts.join(", ")) || "????????? ????????????",
  //   };
  // },
  ??????(topic) {
    if (!topic.subconcepts) return null;
    return {
      text: "?????? ????????? ????????? ?????? ??????????????????",
      additionalInfo: [...topic.subconcepts]
        .sort(() => Math.random() - 0.5)
        .join(", "),
      answer: topic.subconcepts.join(", "),
    };
  },
};

async function getQuestionsByPage(pageId: string) {
  try {
    const { text, pageTitle } = await getPageContent(pageId);
    const parsed = parse(text);

    // console.log(JSON.stringify(parsed, null, 2));
    const concepts = (parsed as YamlBlock[]).map(yaml2concept);

    console.clear();
    // console.log(JSON.stringify(parsed, null, 2));

    const flattenedConcepts = concepts.flatMap((e) => flattenConcepts(e, []));

    const sampledConcept =
      flattenedConcepts[Math.floor(Math.random() * flattenedConcepts.length)];

    const availableTemplates = [
      "??????",
      sampledConcept.description && "??????",
      sampledConcept.validQuestions?.includes("??????") &&
        sampledConcept.subconcepts &&
        "??????",
    ].filter(Boolean);

    const template =
      questionTemplates[
        availableTemplates[
          Math.floor(Math.random() * availableTemplates.length)
        ] as string
      ];

    const question = template(sampledConcept)!;
    return {
      ...question,
      path: [pageTitle, ...sampledConcept.path],
      label: sampledConcept.label,
    };
  } catch (e) {
    console.log("Error while parsing page occured");
    console.log("Document id:", pageId);

    throw e;
  }
}

const BOT_TOKEN = Deno.env.get("BOT_TOKEN");

async function sendMessage(target: string, message: string) {
  await (
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      body: JSON.stringify({
        chat_id: target,
        text: message
          .replaceAll("(", "\\(")
          .replaceAll(")", "\\)")
          .replaceAll(".", "\\."),
        parse_mode: "MarkdownV2",
        reply_markup: {
          keyboard: [
            [
              {
                text: "????",
              },
              {
                text: "????",
              },
            ],
          ],
        },
      }),
      headers: new Headers({
        "Content-Type": "application/json",
      }),
      method: "POST",
    })
  ).json();
}

serve({
  "/": async (request) => {
    const pages = await getPagesInCollection("6ro17j28-deVd7tdzoI");
    const pageId = pages[Math.floor(Math.random() * pages.length)];
    const question = await getQuestionsByPage(pageId);
    const message = (await request.json()).message;
    const sender = message.from.id;

    const textQuestion = [
      "Q) " + question.text,
      question.additionalInfo
        ? "```\n" + question.additionalInfo + "\n```"
        : "",
      "A) ||" + question.answer + "||",
      question.path &&
        "\n??????: " +
          question.path
            .slice(0, question.label.startsWith("#") ? -1 : undefined)
            .join(" \\> "),
    ]
      .filter(Boolean)
      .join("\n");

    await sendMessage(sender, textQuestion);
    return new Response("");
  },
});
