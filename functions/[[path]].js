export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/api\//, "");
    const method = request.method;

    const corsHeaders = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS, PUT, DELETE",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };

    if (method === "OPTIONS") {
        return new Response(null, { headers: corsHeaders });
    }

    try {
        // Enforce active D1 cloud SQL database binding
        if (!env.DB) {
            return new Response(JSON.stringify({ error: "Cloudflare D1 Database binding 'DB' not configured. Please check your bindings settings." }), {
                status: 500,
                headers: { "Content-Type": "application/json", ...corsHeaders }
            });
        }

        // Endpoint routing resolver
        if (path === "login" && method === "POST") {
            const body = await request.json();
            const { idVal, passVal, role } = body;

            const user = await env.DB.prepare(
                "SELECT * FROM students_table WHERE role = ? AND phone = ? AND password = ?"
            ).bind(role, idVal, passVal).first();

            if (!user) {
                return new Response(JSON.stringify({ error: "Access Denied: Invalid credentials." }), {
                    status: 401,
                    headers: { "Content-Type": "application/json", ...corsHeaders }
                });
            }
            return new Response(JSON.stringify(user), { headers: { "Content-Type": "application/json", ...corsHeaders } });
        }

        if (path === "login-bypass" && method === "POST") {
            // Grab or auto-generate Master Teacher Admin
            let admin = await env.DB.prepare("SELECT * FROM students_table WHERE role = 'admin' LIMIT 1").first();
            if (!admin) {
                await env.DB.prepare(
                    "INSERT INTO students_table (name, phone, password, grade, role, grades_record) VALUES (?, ?, ?, ?, ?, ?)"
                ).bind("Administrator", "admin", "admin", "all", "admin", "[]").run();
                
                admin = await env.DB.prepare("SELECT * FROM students_table WHERE role = 'admin' LIMIT 1").first();
            }
            return new Response(JSON.stringify(admin), { headers: { "Content-Type": "application/json", ...corsHeaders } });
        }

        if (path.startsWith("students")) {
            const studentId = url.searchParams.get("id");
            if (method === "GET") {
                const { results } = await env.DB.prepare("SELECT * FROM students_table").all();
                return new Response(JSON.stringify(results), { headers: { "Content-Type": "application/json", ...corsHeaders } });
            }
            if (method === "POST") {
                const s = await request.json();
                const result = await env.DB.prepare(
                    "INSERT INTO students_table (name, phone, password, grade, role, grades_record) VALUES (?, ?, ?, ?, 'student', '[]')"
                ).bind(s.name, s.phone, s.password, s.grade).run();
                return new Response(JSON.stringify({ success: true, id: result.meta.last_row_id }), { headers: { "Content-Type": "application/json", ...corsHeaders } });
            }
            if (method === "PUT") {
                const s = await request.json();
                await env.DB.prepare(
                    "UPDATE students_table SET name = ?, phone = ?, password = ?, grade = ? WHERE id = ?"
                ).bind(s.name, s.phone, s.password, s.grade, parseInt(studentId)).run();
                return new Response(JSON.stringify({ success: true }), { headers: { "Content-Type": "application/json", ...corsHeaders } });
            }
            if (method === "DELETE") {
                await env.DB.prepare("DELETE FROM students_table WHERE id = ?").bind(parseInt(studentId)).run();
                return new Response(JSON.stringify({ success: true }), { headers: { "Content-Type": "application/json", ...corsHeaders } });
            }
        }

        if (path === "students-privilege" && method === "POST") {
            const body = await request.json();
            const user = await env.DB.prepare("SELECT * FROM students_table WHERE id = ?").bind(body.id).first();
            if (user) {
                const nextRole = user.role === "admin" ? "student" : "admin";
                const nextGrade = nextRole === "admin" ? "all" : 7;
                await env.DB.prepare("UPDATE students_table SET role = ?, grade = ? WHERE id = ?").bind(nextRole, nextGrade, body.id).run();
                return new Response(JSON.stringify({ success: true }), { headers: { "Content-Type": "application/json", ...corsHeaders } });
            }
        }

        if (path.startsWith("videos")) {
            const videoId = url.searchParams.get("id");
            if (method === "GET") {
                const { results } = await env.DB.prepare("SELECT * FROM videos_table ORDER BY lesson ASC").all();
                return new Response(JSON.stringify(results), { headers: { "Content-Type": "application/json", ...corsHeaders } });
            }
            if (method === "POST") {
                const v = await request.json();
                const result = await env.DB.prepare(
                    "INSERT INTO videos_table (filename, title, lesson, grade) VALUES (?, ?, ?, ?)"
                ).bind(v.filename, v.title, v.lesson, v.grade).run();
                return new Response(JSON.stringify({ success: true, id: result.meta.last_row_id }), { headers: { "Content-Type": "application/json", ...corsHeaders } });
            }
            if (method === "DELETE") {
                await env.DB.prepare("DELETE FROM videos_table WHERE id = ?").bind(parseInt(videoId)).run();
                return new Response(JSON.stringify({ success: true }), { headers: { "Content-Type": "application/json", ...corsHeaders } });
            }
        }

        if (path.startsWith("materials")) {
            const matId = url.searchParams.get("id");
            if (method === "GET") {
                const { results } = await env.DB.prepare("SELECT * FROM materials_table ORDER BY id DESC").all();
                return new Response(JSON.stringify(results), { headers: { "Content-Type": "application/json", ...corsHeaders } });
            }
            if (method === "POST") {
                const m = await request.json();
                const result = await env.DB.prepare(
                    "INSERT INTO materials_table (title, grade, type, desc, filename) VALUES (?, ?, ?, ?, ?)"
                ).bind(m.title, m.grade, m.type, m.desc, m.filename).run();
                return new Response(JSON.stringify({ success: true, id: result.meta.last_row_id }), { headers: { "Content-Type": "application/json", ...corsHeaders } });
            }
            if (method === "DELETE") {
                await env.DB.prepare("DELETE FROM materials_table WHERE id = ?").bind(parseInt(matId)).run();
                return new Response(JSON.stringify({ success: true }), { headers: { "Content-Type": "application/json", ...corsHeaders } });
            }
        }

        if (path === "feed") {
            if (method === "GET") {
                const { results } = await env.DB.prepare("SELECT * FROM feed_table ORDER BY id ASC").all();
                // Compile comments for each post
                for (let post of results) {
                    try {
                        post.comments = JSON.parse(post.comments_json || "[]");
                    } catch(e) { post.comments = []; }
                }
                return new Response(JSON.stringify(results), { headers: { "Content-Type": "application/json", ...corsHeaders } });
            }
            if (method === "POST") {
                const f = await request.json();
                const result = await env.DB.prepare(
                    "INSERT INTO feed_table (author, date, text, attachment_name, image, comments_json) VALUES (?, ?, ?, ?, ?, '[]')"
                ).bind(f.author, f.date, f.text, f.attachment_name, f.image).run();
                return new Response(JSON.stringify({ success: true, id: result.meta.last_row_id }), { headers: { "Content-Type": "application/json", ...corsHeaders } });
            }
        }

        if (path === "comments" && method === "POST") {
            const body = await request.json();
            const post = await env.DB.prepare("SELECT * FROM feed_table WHERE id = ?").bind(body.postId).first();
            if (post) {
                let comments = [];
                try {
                    comments = JSON.parse(post.comments_json || "[]");
                } catch(e) { comments = []; }

                comments.push({ author: body.author, text: body.text });
                
                await env.DB.prepare("UPDATE feed_table SET comments_json = ? WHERE id = ?").bind(
                    JSON.stringify(comments), body.postId
                ).run();

                return new Response(JSON.stringify({ success: true }), { headers: { "Content-Type": "application/json", ...corsHeaders } });
            }
        }

        if (path === "chat" && method === "POST") {
            const body = await request.json();
            const { query, name, grade } = body;

            // Direct proxy fetch to Groq API securely (Groq Key never exposed to client browser)
            const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                method: "POST",
                headers: {
                    "Authorization": "Bearer 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",
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    model: "llama-3.1-8b-instant",
                    messages: [
                        {
                            role: "system",
                            content: `You are Help Bot, a professional mathematics and science tutor for MR. Ahmed Abd-ElFatah's academy. The active student is ${name}, alignment: ${grade}. If they ask to solve science or mathematics problems, explain the logic step-by-step using clear numbered items, equations, and professional guidelines. Talk clearly, concisely, and gracefully.`
                        },
                        { role: "user", content: query }
                    ],
                    temperature: 0.5
                })
            });

            const data = await response.json();
            const answer = data.choices && data.choices[0] ? data.choices[0].message.content : "No response generated. Please contact MR. Ahmed's support.";
            return new Response(JSON.stringify({ response: answer }), { headers: { "Content-Type": "application/json", ...corsHeaders } });
        }

        if (path === "export" && method === "GET") {
            const students = (await env.DB.prepare("SELECT * FROM students_table").all()).results;
            const videos = (await env.DB.prepare("SELECT * FROM videos_table").all()).results;
            const feed = (await env.DB.prepare("SELECT * FROM feed_table").all()).results;
            const materials = (await env.DB.prepare("SELECT * FROM materials_table").all()).results;
            return new Response(JSON.stringify({ students, videos, feed, materials }), {
                headers: { "Content-Type": "application/json", ...corsHeaders }
            });
        }

        if (path === "sql" && method === "POST") {
            const body = await request.json();
            const results = (await env.DB.prepare(body.query).all()).results;
            return new Response(JSON.stringify({ results }), { headers: { "Content-Type": "application/json", ...corsHeaders } });
        }

        return new Response(JSON.stringify({ error: `Not found: /api/${path}` }), {
            status: 404,
            headers: { "Content-Type": "application/json", ...corsHeaders }
        });

    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
            status: 500,
            headers: { "Content-Type": "application/json", ...corsHeaders }
        });
    }
}
