import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { Octokit } from "@octokit/rest";

function parseGitHubUrl(url: string) {
  const match = url.match(/github\.com\/([^/]+)\/([^/]+)/);
  if (!match) throw new Error("Invalid GitHub URL");
  return { owner: match[1], repo: match[2].replace(".git", "") };
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

async function auditAnswer(question: string, answer: string, codeContext: string, apiKey: string): Promise<string> {
  const anthropic = new Anthropic({ apiKey });
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1000,
    system: `You are a strict code review auditor. Audit the answer for:
1. Hallucinated file paths or line numbers not in the code
2. Overconfident claims not supported by the code
3. Suggested fixes that could break something else
4. Logical gaps in reasoning
Be specific. End with: TRUST LEVEL: HIGH / MEDIUM / LOW`,
    messages: [{ role: "user", content: `QUESTION: ${question}\n\nANSWER TO AUDIT: ${answer}\n\nACTUAL CODE:\n${codeContext.slice(0, 30000)}` }],
  });
  return response.content[0].type === "text" ? response.content[0].text : "";
}

export async function POST(req: NextRequest) {
  try {
    const { githubUrl, question, conversationHistory, codeContext: existingContext, apiKey } = await req.json();

    if (!apiKey || !apiKey.startsWith("sk-ant-")) {
      return NextResponse.json({ error: "Valid Anthropic API key required (sk-ant-...)" }, { status: 400 });
    }

    const anthropic = new Anthropic({ apiKey });
    let codeContext = existingContext;

    if (!codeContext && githubUrl) {
      const { owner, repo } = parseGitHubUrl(githubUrl);
      codeContext = await fetchRepoFiles(owner, repo);
    }

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1000,
      system: `You are an expert code investigator. Always ground answers in specific files and line numbers.
Format citations as: [filename:line_range]
Never make up file paths.
CODEBASE:
${codeContext}`,
      messages: [...(conversationHistory || []), { role: "user", content: question }],
    });

    const answer = response.content[0].type === "text" ? response.content[0].text : "";
    const audit = await auditAnswer(question, answer, codeContext, apiKey);

    return NextResponse.json({ answer, audit, codeContext });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}