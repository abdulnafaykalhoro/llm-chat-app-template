   
  // Nafay AI - Real Pollinations Video Backend
  if (url.pathname === "/api/create-video") {
    if (request.method !== "POST") {
      return Response.json(
        { error: "Method not allowed" },
        { status: 405 }
      );
    }

    const settings = env as Env & {
      POLLINATIONS_API_KEY?: string;
      VIDEO_ENABLED?: string;
      VIDEO_ACCESS_CODE?: string;
    };

    // Do not spend paid credits until enabled
    if (settings.VIDEO_ENABLED !== "yes") {
      return Response.json(
        {
          error: "Video generation is not enabled yet. Paid video credits are required."
        },
        { status: 503 }
      );
    }

    const accessCode = request.headers.get("X-Video-Code");

    if (
      !settings.VIDEO_ACCESS_CODE ||
      accessCode !== settings.VIDEO_ACCESS_CODE
    ) {
      return Response.json(
        { error: "Incorrect video access code." },
        { status: 403 }
      );
    }

    if (!settings.POLLINATIONS_API_KEY) {
      return Response.json(
        { error: "Pollinations API key is missing." },
        { status: 503 }
      );
    }

    try {
      const body = await request.json() as {
        prompt?: string;
      };

      const prompt = body.prompt?.trim();

      if (!prompt || prompt.length > 1000) {
        return Response.json(
          { error: "Enter a prompt (maximum 1000 characters)." },
          { status: 400 }
        );
      }

      const model = "alibaba/wan-2.2-fast";

      const endpoint = new URL(
        "https://gen.pollinations.ai/video/" +
        encodeURIComponent(prompt)
      );

      endpoint.searchParams.set("model", model);
      endpoint.searchParams.set("duration", "5");

      const apiResponse = await fetch(endpoint.toString(), {
        headers: {
          Authorization:
            "Bearer " + settings.POLLINATIONS_API_KEY,
          Prefer: "respond-async"
        }
      });

      if (apiResponse.status === 202) {
        const job = await apiResponse.json() as {
          id?: string;
        };

        if (!job.id) {
          throw new Error("Video job ID missing");
        }

        return Response.json({
          status: "processing",
          jobId: job.id
        });
      }

      if (!apiResponse.ok) {
        return Response.json(
          {
            error:
              "Video provider rejected the request. Check paid credits and model access.",
            providerStatus: apiResponse.status
          },
          { status: 502 }
        );
      }

      const videoType =
        apiResponse.headers.get("content-type") || "";

      if (!videoType.startsWith("video/")) {
        return Response.json(
          { error: "Unexpected provider response." },
          { status: 502 }
        );
      }

      return new Response(apiResponse.body, {
        headers: {
          "Content-Type": videoType,
          "Cache-Control": "no-store"
        }
      });

    } catch (error) {
      console.error("Video API error:", error);

      return Response.json(
        { error: "Video generation request failed." },
        { status: 500 }
      );
    }
  }

  // Check asynchronous video result
  if (url.pathname === "/api/video-result") {
    const settings = env as Env & {
      POLLINATIONS_API_KEY?: string;
      VIDEO_ACCESS_CODE?: string;
    };

    if (
      !settings.VIDEO_ACCESS_CODE ||
      request.headers.get("X-Video-Code") !==
        settings.VIDEO_ACCESS_CODE
    ) {
      return Response.json(
        { error: "Unauthorized" },
        { status: 403 }
      );
    }

    const id = url.searchParams.get("id");

    if (!id || !/^[a-zA-Z0-9_-]{1,128}$/.test(id)) {
      return Response.json(
        { error: "Invalid video job ID" },
        { status: 400 }
      );
    }

    if (!settings.POLLINATIONS_API_KEY) {
      return Response.json(
        { error: "API key missing" },
        { status: 503 }
      );
    }

    const result = await fetch(
      "https://gen.pollinations.ai/v1/jobs/" +
      encodeURIComponent(id) + "/result",
      {
        headers: {
          Authorization:
            "Bearer " + settings.POLLINATIONS_API_KEY
        }
      }
    );

    if (result.status === 202 ||
        result.status === 404) {
      return Response.json(
        { status: "processing" },
        { status: 202 }
      );
    }

    if (!result.ok) {
      return Response.json(
        { error: "Video job failed or expired." },
        { status: 502 }
      );
    }

    const contentType =
      result.headers.get("content-type") || "";

    if (!contentType.startsWith("video/")) {
      return Response.json(
        { error: "Video result is not ready." },
        { status: 502 }
      );
    }

    return new Response(result.body, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "no-store"
      }
    });
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
	try {
		// Parse JSON request body
		const { messages = [] } = (await request.json()) as {
			messages: ChatMessage[];
		};

		// Add system prompt if not present
		if (!messages.some((msg) => msg.role === "system")) {
			messages.unshift({ role: "system", content: SYSTEM_PROMPT });
		}

		const stream = await env.AI.run(
			MODEL_ID,
			{
				messages,
				max_tokens: 1024,
				stream: true,
			},
			{
				// Uncomment to use AI Gateway
				// gateway: {
				//   id: "YOUR_GATEWAY_ID", // Replace with your AI Gateway ID
				//   skipCache: false,      // Set to true to bypass cache
				//   cacheTtl: 3600,        // Cache time-to-live in seconds
				// },
			},
		);

		return new Response(stream, {
			headers: {
				"content-type": "text/event-stream; charset=utf-8",
				"cache-control": "no-cache",
				connection: "keep-alive",
			},
		});
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
