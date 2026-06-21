/**
 * LLM Chat Application Template - Firewall for AI Edition
 * * This version is specifically optimized to catch and return 
 * Cloudflare AI Gateway Firewall blocks (PII, etc.) as custom JSON.
 */
import { Env, ChatMessage } from "./types";

// Model ID for Workers AI model
const MODEL_ID = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

// Default system prompt
const SYSTEM_PROMPT =
	"You are a helpful, friendly assistant. Provide concise and accurate responses.";

export default {
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
			if (request.method === "POST") {
				return handleChatRequest(request, env);
			}
			return new Response("Method not allowed", { status: 405 });
		}

		return new Response("Not found", { status: 404 });
	},
} satisfies ExportedHandler<Env>;

/**
 * Handles chat API requests with Firewall Interception
 */
async function handleChatRequest(
	request: Request,
	env: Env,
): Promise<Response> {
	
	// 1. Initial WAF Header Check (Standard WAF/Bot Rules)
	const wafAction = request.headers.get("cf-mitigated-action"); 
	if (wafAction && wafAction !== "allow") {
		return new Response(
			JSON.stringify({ 
				error: "Request Blocked by Edge Security",
				message: "Your request was blocked by Cloudflare WAF before reaching the AI."
			}),
			{ status: 403, headers: { "content-type": "application/json" } }
		);
	}

	try {
		const { messages = [] } = (await request.json()) as {
			messages: ChatMessage[];
		};

		if (!messages.some((msg) => msg.role === "system")) {
			messages.unshift({ role: "system", content: SYSTEM_PROMPT });
		}

		// 2. RUN AI THROUGH GATEWAY
		// This is where the "Firewall for AI" PII rules live.
		const aiResponse = await env.AI.run(
    MODEL_ID,
    {
        messages,
        max_tokens: 1024,
    },
    {
        returnRawResponse: true,
    },
);

		// 3. INTERCEPT GATEWAY BLOCK (The Custom JSON Logic)
		// If the Gateway blocks PII, it returns a 403 status.
		if (aiResponse instanceof Response && aiResponse.status === 403) {
			const blockData = await aiResponse.json() as any;
			
			// We rebuild the response to ensure your "Custom JSON" body is preserved
			return new Response(
				JSON.stringify({
					status: "error",
					code: 403,
					message: blockData.message || "Message Blocked: Our security policies prevent the transmission of Personally Identifiable Information (PII)."
				}),
				{
					status: 403,
					headers: { "content-type": "application/json" }
				}
			);
		}

		// 4. Return standard streaming response if NOT blocked
		return aiResponse as Response;

	} catch (error) {
		const errorText = error instanceof Error ? error.message : String(error);
		console.error("Chat Error:", errorText);

		// Handle cases where the AI library throws a policy violation error
		if (errorText.toLowerCase().includes('policy') || errorText.toLowerCase().includes('safety')) {
			return new Response(
				JSON.stringify({ 
					status: "error",
					message: "The AI Gateway has identified a policy violation in this prompt." 
				}),
				{ status: 403, headers: { "content-type": "application/json" } }
			);
		}

		return new Response(
			JSON.stringify({ error: "An unexpected error occurred." }),
			{ status: 500, headers: { "content-type": "application/json" } }
		);
	}
}
