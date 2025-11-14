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
    
    // --- START WAF SIGNAL CHECK FIX (Header Check) ---
    
    // Cloudflare injects these headers if a security rule is triggered (even if set to Log/Challenge)
    const wafAction = request.headers.get("cf-mitigated-action"); 
    const threatScoreHeader = request.headers.get("cf-threat-score");
    const threatScore = threatScoreHeader ? parseInt(threatScoreHeader) : null;

    // Check for a high-confidence threat signal (e.g., a challenge action or high threat score)
    // This intercepts the block signal before the code proceeds to the LLM call and crashes.
    if (
        wafAction || 
        (threatScore !== null && threatScore >= 90)
    ) {
        console.warn(`WAF/Bot signal detected (Action: ${wafAction}, Score: ${threatScore}). Blocking request in Worker.`);
        
        // Return a clean, custom JSON block message immediately.
        return new Response(
            JSON.stringify({ 
                error: "Policy Violation: Input blocked due to security rules.",
                details: "Sensitive content (PII/Unsafe Content) was detected in the prompt."
            }),
            {
                status: 403, // Return Forbidden status
                headers: { "content-type": "application/json" },
            },
        );
    }
    // --- END WAF SIGNAL CHECK FIX ---

	try {
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
        // --- START FINAL CATCH BLOCK FIX ---
        const errorText = error instanceof Error ? error.message : String(error);
        console.error("Error processing chat request:", errorText);
        
        // If the error message indicates a security/policy failure from the LLM, 
        // return the custom message instead of the generic 500 error.
        if (errorText.toLowerCase().includes('policy violation') || 
            errorText.toLowerCase().includes('safety') || 
            errorText.toLowerCase().includes('content blocked')
        ) {
            return new Response(
                JSON.stringify({ 
                    error: "Input blocked due to security rules.",
                    details: "Sensitive content (PII/Unsafe Content) was detected in the prompt."
                }),
                {
                    status: 403, // Return 403 Forbidden on security-related crash
                    headers: { "content-type": "application/json" },
                },
            );
        }

        // Default: Generic error for all other unhandled crashes (network, JSON parsing, etc.)
		return new Response(
			JSON.stringify({ error: "Input blocked due to security rules.." }),
			{
				status: 500,
				headers: { "content-type": "application/json" },
			},
		);
        // --- END FINAL CATCH BLOCK FIX ---
	}
}
