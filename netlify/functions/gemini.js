export async function handler(event) {
    console.log("Function triggered");

    try {
        const body = JSON.parse(event.body);
        console.log("Incoming body:", body);

        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${process.env.GEMINI_API_KEY}`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    contents: body.contents,
                    generationConfig: { temperature: 0.8 }
                })
            }
        );

        const data = await response.json();
        console.log("Gemini response:", data);

        return {
            statusCode: 200,
            body: JSON.stringify(data)
        };

    } catch (error) {
        console.error("ERROR:", error);

        return {
            statusCode: 500,
            body: JSON.stringify({
                error: error.message
            })
        };
    }
}