import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextRequest, NextResponse } from "next/server";
import { Octokit } from "@octokit/rest";

function parseGitHubUrl(url: string) {
  const match = url.match(/github\.com\/([^/]+)\/([^/]+)/);
  if (!match) throw new Error("Invalid GitHub URL");
  return { owner: match[1], repo: match[2].replace(".git", "") };
}

function detectKeyType(apiKey: string): "anthropic" | "google" | "unknown" {
  if (apiKey.startsWith("sk-ant-")) return "anthropic";
  if (apiKey.startsWith("AIza")) return "google";
  return "unknown";
}

async function fetchRepoFiles(owner: string, repo: string): Promise<string> {
  const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
  const files: string[] = [];
  async function fetchDir(path = "") {
    const { data } = await octokit.repos.getContent({ owner, repo, path });
    if (!Array.isArray(data)) return;
    for (const item of data) {
      if (item.type === "dir" && !["node_modules", ".git", "dist", ".next"].includes(item.name)) {
        await fetchDir(item.path);
      } else if (item.type === "file" && /\.(ts|tsx|js|jsx|py|json|md)$/.test(item.name)) {
        try {
          const { data: fileData } = await octokit.repos.getContent({ owner, repo, path: item.path });
          if ("content" in fileData) {
            const content = Buffer.from(fileData.content, "base64").toString("utf-8");
            files.push(`\n\n=== FILE: ${item.path} ===\n${content}`);
          }
        } catch {}
      }
    }
  }
  await fetchDir();
  return files.join("").slice(0, 80000);
}

async function askAnthropic(apiKey: string, systemPrompt: string, messages: {role: string, content: string}[]): Promise<string> {
  const anthropic = new Anthropic({ apiKey });
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1000,
    system: systemPrompt,
    messages: messages as {role: "user" | "assistant", content: string}[],
  });
  return response.content[0].type === "text" ? response.content[0].text : "";
}

async function askGemini(apiKey: string, systemPrompt: string, messages: {role: string, content: string}[]): Promise<string> {
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash", systemInstruction: systemPrompt });
  
  const history = messages.slice(0, -1).map(m => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));
  
  const chat = model.startChat({ history });
  const lastMessage = messages[messages.length - 1].content;
  const result = await chat.sendMessage(lastMessage);
  return result.response.text();
}

export async function POST(req: NextRequest) {
  try {
    const { githubUrl, question, conversationHistory, codeContext: existingContext, apiKey } = await req.json();

    const keyType = detectKeyType(apiKey);
    if (keyType === "unknown") {
      return NextResponse.json({ error: "Invalid API key. Use Anthropic (sk-ant-...) or Google AI Studio (AIza...) key." }, { status: 400 });
    }

    let codeContext = existingContext;
    if (!codeContext && githubUrl) {
      const { owner, repo } = parseGitHubUrl(githubUrl);
      codeContext = await fetchRepoFiles(owner, repo);
    }

    const systemPrompt = `You are an expert code investigator. Always ground answers in specific files and line numbers.
Format citations as: [filename:line_range]
Never make up file paths.
CODEBASE:
${codeContext}`;

    const messages = [...(conversationHistory || []), { role: "user", content: question }];

    let answer = "";
    let audit = "";

    if (keyType === "anthropic") {
      answer = await askAnthropic(apiKey, systemPrompt, messages);
      
      // Audit with separate Anthropic call
      const auditPrompt = `You are a strict code review auditor. Audit this answer for:
1. Hallucinated file paths or line numbers
2. Overconfident claims not supported by code
3. Suggested fixes that could break something else
4. Logical gaps
Be specific. End with: TRUST LEVEL: HIGH / MEDIUM / LOW`;
      
      audit = await askAnthropic(apiKey, auditPrompt, [
        { role: "user", content: `QUESTION: ${question}\n\nANSWER TO AUDIT: ${answer}\n\nACTUAL CODE:\n${codeContext.slice(0, 30000)}` }
      ]);

    } else {
      answer = await askGemini(apiKey, systemPrompt, messages);
      
      // Audit with separate Gemini call
      const auditSystemPrompt = `You are a strict code review auditor. Audit answers for hallucinated citations, overconfident claims, and logical gaps. End with: TRUST LEVEL: HIGH / MEDIUM / LOW`;
      
      audit = await askGemini(apiKey, auditSystemPrompt, [
        { role: "user", content: `QUESTION: ${question}\n\nANSWER TO AUDIT: ${answer}\n\nACTUAL CODE:\n${codeContext.slice(0, 30000)}` }
      ]);
    }

    return NextResponse.json({ answer, audit, codeContext, provider: keyType });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}