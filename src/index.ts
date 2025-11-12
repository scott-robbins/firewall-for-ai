/**
 * LLM Chat Application Template
 *
 * A simple chat application using Cloudflare Workers AI.
 * This template demonstrates how to implement an LLM-powered chat interface with
 * streaming responses using Server-Sent Events (SSE).
 *
 * @license MIT
 */
import { Env, ChatMessage } from "./types";

// Model ID for Workers AI model
// https://developers.cloudflare.com/workers-ai/models/
const MODEL_ID = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

// Default system prompt
const SYSTEM_PROMPT =
	"You are a helpful, friendly assistant. Provide concise and accurate responses.";

export default {
	/**
	 * Main request handler for the Worker
	 */
	async fetch(
		request: Request,
		env: Env,
		ctx: ExecutionContext,
	): Promise<Response> {
		const url = new URL(request.url);

		// Handle static assets (frontend)
		if (url.pathname === "/" || !url.pathname.startsWith("/api/")) {
			return env.ASSETS.fetch(request);
		}

		// API Routes
		if (url.pathname === "/api/chat") {
			// Handle POST requests for chat
			if (request.method === "POST") {
				return handleChatRequest(request, env);
			}

			// Method not allowed for other request types
			return new Response("Method not allowed", { status: 405 });
		}

		// Handle 404 for unmatched routes
		return new Response("Not found", { status: 404 });
	},
} satisfies ExportedHandler<Env>;

/**
 * Handles chat API requests
 */
async function handleChatRequest(
	request: Request,
	env: Env,
): Promise<Response> {
    // --- START WAF BLOCK CHECK LOGIC ---
    // Check for mitigation headers injected by the WAF before it runs a block/challenge action.
    const wafAction = request.headers.get("cf-mitigated-action"); 
    const threatScoreHeader = request.headers.get("cf-threat-score");
    const threatScore = threatScoreHeader ? parseInt(threatScoreHeader) : null;

    // We check if the WAF was set to 'managed_challenge' or if the threat score 
    // is extremely high (e.g., indicating a high-confidence bot or malicious prompt).
    if (wafAction === "managed_challenge" || (threatScore && threatScore >= 90)) {
        // Stop execution here and return a clean, custom JSON message.
        // The status 403 (Forbidden) is appropriate for a security block.
        return new Response(
            JSON.stringify({
                error: "Request blocked due to security policy.",
                details: "Sensitive data (PII/Unsafe Content) was detected in the prompt. Review your input.",
                action_taken: wafAction || "High-Score Block",
            }),
            {
                status: 403, 
                headers: { "content-type": "application/json" },
            },
        );
    }
    // --- END WAF BLOCK CHECK LOGIC ---
    
	try {
		// If the WAF signal is clean, proceed to LLM inference
		// Parse JSON request body
		const { messages = [] } = (await request.json()) as {
			messages: ChatMessage[];
		};

		// Add system prompt if not present
		if (!messages.some((msg) => msg.role === "system")) {
			messages.unshift({ role: "system", content: SYSTEM_PROMPT });
		}

		const response = await env.AI.run(
			MODEL_ID,
			{
				messages,
				max_tokens: 1024,
			},
			{
				returnRawResponse: true,
				// Uncomment to use AI Gateway
				// gateway: {
				//   id: "YOUR_GATEWAY_ID", // Replace with your AI Gateway ID
				//   skipCache: false,      // Set to true to bypass cache
				//   cacheTtl: 3600,        // Cache time-to-live in seconds
				// },
			},
		);

		// Return streaming response
		return response;
	} catch (error) {
		console.error("Error processing chat request:", error);
		return new Response(
			JSON.stringify({ error: "Failed to process request" }),
			{
				status: 500,
				headers: { "content-type": "application/json" },
			},
		);
	}
}
