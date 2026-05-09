"use client";
import { useState, useRef, useEffect } from "react";

interface Message {
  role: "user" | "assistant";
  content: string;
  audit?: string;
}

export default function Home() {
  const [githubUrl, setGithubUrl] = useState("");
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [repoLoaded, setRepoLoaded] = useState(false);
  const [codeContext, setCodeContext] = useState("");
  const [expandedAudit, setExpandedAudit] = useState<number | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const conversationHistory = messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  async function handleSubmit() {
    if (!question.trim() || loading) return;
    if (!repoLoaded && !githubUrl.trim()) return alert("Enter a GitHub URL first");

    setLoading(true);
    const currentQuestion = question;
    setQuestion("");
    setMessages((prev) => [...prev, { role: "user", content: currentQuestion }]);

    try {
      const res = await fetch("/api/investigate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          githubUrl: repoLoaded ? null : githubUrl,
          question: currentQuestion,
          conversationHistory,
          codeContext: repoLoaded ? codeContext : null,
        }),
      });

      const data = await res.json();
      if (data.error) throw new Error(data.error);

      if (!repoLoaded) {
        setCodeContext(data.codeContext);
        setRepoLoaded(true);
      }

      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: data.answer, audit: data.audit },
      ]);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Something went wrong";
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `Error: ${message}` },
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-gray-950 text-gray-100 flex flex-col">
      <div className="border-b border-gray-800 px-6 py-4">
        <h1 className="text-xl font-bold text-white">Codebase Investigator</h1>
        <p className="text-sm text-gray-400">Paste a GitHub URL and ask questions about the code</p>
      </div>

      {!repoLoaded && (
        <div className="px-6 py-4 border-b border-gray-800 flex gap-3">
          <input
            className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-blue-500"
            placeholder="https://github.com/owner/repo"
            value={githubUrl}
            onChange={(e) => setGithubUrl(e.target.value)}
          />
        </div>
      )}

      {repoLoaded && (
        <div className="px-6 py-2 bg-green-900/20 border-b border-green-800 text-green-400 text-sm">
          ✓ Repo loaded — {githubUrl}
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
        {messages.length === 0 && (
          <div className="text-center text-gray-500 mt-20">
            <p className="text-lg">Enter a GitHub URL and start asking questions</p>
            <p className="text-sm mt-2">Try: "How does auth work?" or "Is there dead code?"</p>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-3xl ${msg.role === "user" ? "bg-blue-600 rounded-2xl rounded-tr-sm px-4 py-3" : "w-full"}`}>
              {msg.role === "user" ? (
                <p className="text-sm">{msg.content}</p>
              ) : (
                <div className="space-y-3">
                  <div className="bg-gray-900 rounded-2xl rounded-tl-sm px-4 py-3">
                    <pre className="text-sm whitespace-pre-wrap font-sans">{msg.content}</pre>
                  </div>
                  {msg.audit && (
                    <div className="border border-gray-700 rounded-lg overflow-hidden">
                      <button
                        onClick={() => setExpandedAudit(expandedAudit === i ? null : i)}
                        className="w-full px-4 py-2 bg-gray-800 text-left text-xs text-gray-400 hover:bg-gray-700 flex justify-between items-center"
                      >
                        <span>🔍 Audit Report</span>
                        <span>{expandedAudit === i ? "▲ Hide" : "▼ Show"}</span>
                      </button>
                      {expandedAudit === i && (
                        <div className="px-4 py-3 bg-gray-850 text-xs text-gray-300">
                          <pre className="whitespace-pre-wrap font-sans">{msg.audit}</pre>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="bg-gray-900 rounded-2xl px-4 py-3">
              <div className="flex gap-1">
                <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-gray-800 px-6 py-4 flex gap-3">
        <textarea
          className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-blue-500 resize-none"
          placeholder="Ask anything about the code..."
          rows={2}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSubmit(); }}}
        />
        <button
          onClick={handleSubmit}
          disabled={loading}
          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 px-6 rounded-lg text-sm font-medium transition-colors"
        >
          {loading ? "..." : "Ask"}
        </button>
      </div>
    </main>
  );
}