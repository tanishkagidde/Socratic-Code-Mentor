// Backend client: health check and the streaming guidance request.
// EventSource can't POST, so SSE is parsed from a fetch() body stream.
(function () {
  "use strict";

  class ApiError extends Error {
    constructor(code, message, retryable = true) {
      super(message);
      this.code = code;
      this.retryable = retryable;
    }
  }

  const FRIENDLY = {
    offline: "I can't reach the mentor backend. Start it with: python -m uvicorn main:app --port 8000 (in the backend folder).",
    missing_key: "The backend has no Gemini API key. Add GEMINI_API_KEY to backend/.env and restart it.",
  };

  const Api = {
    base: "http://127.0.0.1:8000",
    ApiError,

    async health() {
      let response;
      try {
        response = await fetch(`${Api.base}/health`, { signal: AbortSignal.timeout(4000) });
      } catch (_) {
        throw new ApiError("offline", FRIENDLY.offline);
      }
      if (!response.ok) throw new ApiError("offline", `Backend answered ${response.status}.`);
      const data = await response.json();
      if (!data.key_configured) throw new ApiError("missing_key", FRIENDLY.missing_key, false);
      return data;
    },

    /**
     * POST /mentor/stream. Calls onEvent(type, data) for meta / partial /
     * reset / done. Rejects with ApiError on failure, AbortError on abort.
     */
    async stream(body, { signal, onEvent }) {
      let response;
      try {
        response = await fetch(`${Api.base}/mentor/stream`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal,
        });
      } catch (error) {
        if (error.name === "AbortError") throw error;
        throw new ApiError("offline", FRIENDLY.offline);
      }

      if (!response.ok) {
        let data = {};
        try {
          data = await response.json();
        } catch (_) {}
        throw new ApiError(data.code || `http_${response.status}`, FRIENDLY[data.code] || data.message || data.detail || `Request failed (${response.status}).`, data.retryable !== false);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finished = false;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
        let split;
        while ((split = buffer.indexOf("\n\n")) !== -1) {
          const block = buffer.slice(0, split);
          buffer = buffer.slice(split + 2);
          let type = "message";
          const dataLines = [];
          for (const line of block.split("\n")) {
            if (line.startsWith("event:")) type = line.slice(6).trim();
            else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
          }
          if (!dataLines.length) continue;
          const data = JSON.parse(dataLines.join("\n"));
          if (type === "error") throw new ApiError(data.code, FRIENDLY[data.code] || data.message, data.retryable !== false);
          if (type === "done") finished = true;
          onEvent(type, data);
        }
      }
      if (!finished) throw new ApiError("interrupted", "The answer was cut off. Retry.");
    },
  };

  globalThis.Api = Api;
})();
