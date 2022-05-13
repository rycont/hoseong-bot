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

function yaml2concept(yaml: YamlBlock) {
  let [key, contents] = Object.entries(yaml)[0];

  // if (!contents) console.log("Content is null! ", yaml);
  if (!contents.map) {
    contents = [contents as unknown as string];
    console.log(typeof contents);
    // contents = [contents];
  }

  const concept: Concept = {
    ...labelParser(key),
    subconcepts: contents.map((content) => {
      if (typeof content === "string") {
        return labelParser(content) as Concept;
      }
      return yaml2concept(content);
    }),
  };

  return concept;
}

function flattenConcepts(
  concept: Concept,
  path: string[],
): FlatConcept[] {
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

  return [{
    label: concept.label,
    description: concept.description,
    path,
    validQuestions: concept.validQuestions,
  }];
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

  let text = (response.data.text as string).trim().replaceAll("* ", "- ")
    .replaceAll("\n\n", "\n");

  if (text[text.length - 1] === "\\") text = text.slice(0, -1);

  text = text.split("\n").filter((e) => e.trim().length).map(
    (line, index, document) => {
      if (document.length - 1 === index) return line;
      if (
        (document[index + 1].indexOf(document[index + 1].trim()[0]) >
          line.indexOf(line.trim()[0]))
      ) {
        return line + ":";
      }
      return line;
    },
  ).join("\n");

  return { text, pageTitle: response.data.title };
}

const concatHigherLevelConceptLabel = (label: string, path: string[]) => {
  if (!label.startsWith("#")) return label;

  return path[path.length - 1] + "의 " + label.slice(1).trim();
};

const questionTemplates: {
  [key: string]: (topic: FlatConcept) => {
    text: string;
    additionalInfo?: string;
    answer: string;
  } | null;
} = {
  정의(topic: FlatConcept) {
    return {
      text: `"${
        concatHigherLevelConceptLabel(topic.label, topic.path)
      }"에 대해서 설명해주세요`,
      answer: topic.description ||
        (topic.subconcepts && topic.subconcepts.join(", ")) || "설명이 없습니다",
    };
  },
  설명(topic: FlatConcept) {
    if (!topic.description) return null;
    return {
      text: `다음 내용은 무엇에 관련된 내용인가요?` +
        ((topic.path.length && !topic.label.startsWith("#"))
          ? ` (${topic.path[topic.path.length - 1]})`
          : ""),
      additionalInfo: topic.description,
      answer: concatHigherLevelConceptLabel(topic.label, topic.path),
    };
  },
  // 예시(topic) {
  //   return {
  //     text: `"${topic.label}"의 예시를 하나 들어주세요`,
  //     answer: topic.description ||
  //       (topic.subconcepts && topic.subconcepts.join(", ")) || "설명이 없습니다",
  //   };
  // },
  순서(topic) {
    if (!topic.subconcepts) return null;
    return {
      text: "다음 개념을 순서에 맞게 정렬해주세요",
      additionalInfo: [...topic.subconcepts].sort(() => Math.random() - 0.5)
        .join(
          ", ",
        ),
      answer: topic.subconcepts.join(", "),
    };
  },
};

async function getQuestionsByPage(pageId: string) {
  const { text, pageTitle } = await getPageContent(pageId);
  const parsed = parse(text);

  const concepts = (parsed as YamlBlock[]).map(yaml2concept);
  const flattenedConcepts = concepts.flatMap((e) => flattenConcepts(e, []));

  const sampledConcept =
    flattenedConcepts[Math.floor(Math.random() * flattenedConcepts.length)];

  const availableTemplates = [
    "정의",
    sampledConcept.description && "설명",
    sampledConcept.validQuestions?.includes("순서") &&
    sampledConcept.subconcepts && "순서",
  ].filter(Boolean);

  const template = questionTemplates[
    availableTemplates[
      Math.floor(Math.random() * availableTemplates.length)
    ] as string
  ];

  const question = template(sampledConcept)!;
  return { ...question, path: [pageTitle, ...sampledConcept.path] };
}

const BOT_TOKEN = Deno.env.get("BOT_TOKEN");

async function sendMessage(target: string, message: string) {
  console.log(
    await (await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
      {
        body: JSON.stringify({
          chat_id: target,
          text: message.replaceAll("(", "\\(").replaceAll(")", "\\)")
            .replaceAll(".", "\\."),
          parse_mode: "MarkdownV2",
          reply_markup: {
            keyboard: [[{
              text: "👍",
            }, {
              text: "👎",
            }]],
          },
        }),
        headers: new Headers({
          "Content-Type": "application/json",
        }),
        method: "POST",
      },
    )).json(),
  );
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
        ? ("```\n" + question.additionalInfo + "\n```")
        : "",
      "A) ||" + question.answer + "||",
      question.path && ("\n범위: " + question.path.join(" \\> ")),
    ].filter(Boolean).join("\n");

    await sendMessage(sender, textQuestion);
    return new Response("");
  },
});
