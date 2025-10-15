// MCP Server - 2 Tools: Rank Businesses + Create Job
import express from "express";
import cors from "cors";
import pg from "pg";
import { readFileSync } from "fs";
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const SERVER_INFO = {
  name: "painting-concierge",
  version: "2.0.0"
};

// Load component bundle
let COMPONENT_JS = "";
try {
  COMPONENT_JS = readFileSync(join(__dirname, "web/dist/component.js"), "utf8");
  console.log("✅ Component loaded");
} catch (error) {
  console.warn("⚠️  Component not found - run 'npm run build' in /web");
}

// Load smart questions knowledge base
let SMART_QUESTIONS = null;
try {
  SMART_QUESTIONS = readFileSync(join(__dirname, "smart-questions.txt"), "utf8");
  console.log("✅ Smart questions loaded");
} catch (error) {
  console.warn("⚠️  smart-questions.txt not found");
}

// === RANKING LOGIC ===
function normalizeWeights(w = {}) {
  const base = { quality: 0.34, reliability: 0.33, value: 0.33, ...w };
  const sum = Object.values(base).reduce((a, b) => a + (Number(b) || 0), 0) || 1;
  return {
    quality: base.quality / sum,
    reliability: base.reliability / sum,
    value: base.value / sum,
  };
}

async function rankPainters({ suburb, postcode, area, region, limit = 5, weights = {} }) {
  const W = normalizeWeights(weights);
  const params = [];
  const where = [];

  if (postcode) { params.push(postcode); where.push(`postcode = $${params.length}`); }
  if (suburb)   { params.push(suburb);   where.push(`lower(suburb) = lower($${params.length})`); }
  if (area)     { params.push(area);     where.push(`lower(area) = lower($${params.length})`); }
  if (region)   { params.push(region);   where.push(`lower(region) = lower($${params.length})`); }

  const sql = `
    select
      record_id as id,
      company_name as name,
      ss_profile_url,
      owner_name,
      whatsapp_number,
      region,
      area,
      suburb,
      star_rating::numeric as star_rating,
      jobs_won::numeric as jobs_won,
      number_of_reviews::numeric as number_of_reviews,
      engagement_rate::numeric as engagement_rate,
      rejection_rate::numeric as rejection_rate,
      coalesce(star_rating::numeric, 0) as quality_score,
      coalesce(1 - nullif(rejection_rate::numeric, 0), 0) as reliability_score,
      coalesce(case when number_of_reviews::numeric > 0 then 1 else 0.5 end, 0) as value_score
    from painter_list
    ${where.length ? `where ${where.join(" and ")}` : ""}
  `;

  const { rows } = await pool.query(sql, params);

  const scored = rows.map(p => {
    const q = Number(p.quality_score || 0);
    const r = Number(p.reliability_score || 0);
    const v = Number(p.value_score || 0);
    return { 
      ...p, 
      weights: W, 
      score: q * W.quality + r * W.reliability + v * W.value 
    };
  }).sort((a, b) => b.score - a.score);

  return scored.slice(0, Math.max(1, Math.min(limit, 10)));
}

// === UI TEMPLATE ===
function createUITemplate() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    body { margin: 0; padding: 0; font-family: system-ui, -apple-system, sans-serif; }
    .carousel { scroll-snap-type: x mandatory; }
    .carousel > * { scroll-snap-align: start; }
  </style>
</head>
<body>
  <div id="root"></div>
  <script type="importmap">
  {
    "imports": {
      "react": "https://esm.sh/react@18.2.0",
      "react-dom/client": "https://esm.sh/react-dom@18.2.0/client"
    }
  }
  </script>
  <script type="module">
    ${COMPONENT_JS}
  </script>
</body>
</html>`;
}

// === TOOLS ===
const TOOLS = [
  {
    name: "get_top_painters",
    description: "Get ranked list of top painters for a location. Returns painter profiles with ratings, reviews, and contact info. Use this BEFORE creating a job request to show customers who's available.",
    inputSchema: {
      type: "object",
      properties: {
        postcode: {
          type: "string",
          description: "Job location postcode (e.g., '2000' for Sydney CBD)"
        },
        suburb: {
          type: "string",
          description: "Suburb name (optional if postcode provided)"
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 10,
          default: 5,
          description: "Number of painters to return (default 5)"
        },
        preferences: {
          type: "object",
          description: "Customer preferences for ranking",
          properties: {
            quality: {
              type: "number",
              minimum: 0,
              maximum: 1,
              description: "Weight for quality/ratings (0-1)"
            },
            reliability: {
              type: "number", 
              minimum: 0,
              maximum: 1,
              description: "Weight for reliability/response rate (0-1)"
            },
            value: {
              type: "number",
              minimum: 0,
              maximum: 1, 
              description: "Weight for value/experience (0-1)"
            }
          }
        }
      },
      required: ["postcode"]
    }
  },
  {
    name: "create_job_request",
    description: `Creates a painting job request. Use the smart questions guidance below to ask follow-up questions BEFORE calling this tool.

${SMART_QUESTIONS || 'SMART QUESTIONS GUIDANCE:\n\nAlways ask about:\n1. What surfaces need painting (walls, ceilings, trims, doors)\n2. Interior or exterior\n3. Property type (house, apartment, townhouse)\n4. Number of rooms or approximate size\n5. Current condition of surfaces\n6. Preferred timing\n7. Budget expectations\n\nFor interior jobs:\n- If they say "bedroom" ask: Just this room or multiple rooms?\n- If multiple rooms: Is this the whole property or specific rooms?\n- Always confirm: Does this include ceilings and trims?\n\nFor exterior jobs:\n- Ask about property type and storeys\n- Ask about current surface (brick, weatherboard, render)\n- Ask about condition (good, needs prep, peeling paint)\n\nFor budget:\n- Provide a rough estimate first based on what they\'ve described\n- Then ask: "Does this budget range work for you?"'}

Only call this tool once you have enough detail to create a comprehensive job brief.`,
    inputSchema: {
      type: "object",
      properties: {
        customer_name: { type: "string" },
        customer_email: { type: "string", format: "email" },
        customer_mobile: { type: "string" },
        job_title: { 
          type: "string",
          description: "Brief descriptive title (e.g., '3 bedroom interior repaint')"
        },
        job_description: { 
          type: "string",
          description: "Detailed description including all surfaces, rooms, and special requirements"
        },
        location: {
          type: "object",
          properties: {
            postcode: { type: "string" },
            suburb: { type: "string" },
            state: { type: "string", default: "NSW" }
          },
          required: ["postcode"]
        },
        job_details: {
          type: "object",
          properties: {
            category: {
              type: "string",
              enum: ["interior", "exterior", "both"],
              description: "Type of painting work"
            },
            property_type: {
              type: "string",
              enum: ["house", "apartment", "townhouse", "commercial"],
              description: "Type of property"
            },
            num_rooms: { 
              type: "integer",
              description: "Number of rooms (for interior jobs)"
            },
            storeys: {
              type: "integer",
              description: "Number of storeys (for exterior jobs)"
            },
            surfaces: {
              type: "object",
              properties: {
                walls: { type: "boolean", default: true },
                ceilings: { type: "boolean" },
                trims: { type: "boolean" },
                doors: { type: "boolean" }
              }
            },
            condition: {
              type: "string",
              enum: ["good", "fair", "needs_prep", "poor"],
              description: "Current condition of surfaces"
            }
          }
        },
        budget_range: { 
          type: "string",
          description: "Expected budget (e.g., '$2000-$3000' or 'flexible')"
        },
        timing: { 
          type: "string",
          description: "When work should be done (e.g., 'within 2 weeks', 'next month')"
        },
        site_visit_needed: {
          type: "boolean",
          default: true,
          description: "Whether a site visit is needed for accurate quote"
        }
      },
      required: ["customer_name", "customer_email", "job_title", "job_description", "location"]
    }
  }
];

// === TOOL HANDLERS ===
async function getTopPainters(args) {
  try {
    const painters = await rankPainters({
      postcode: args.postcode,
      suburb: args.suburb,
      limit: args.limit || 5,
      weights: args.preferences || {}
    });

    if (!painters.length) {
      return {
        content: [{
          type: "text",
          text: `❌ No painters found for ${args.suburb || 'postcode'} ${args.postcode}\n\nTry a nearby suburb or broader area.`
        }]
      };
    }

    // Return with carousel UI
    return {
      content: [{
        type: "resource",
        resource: {
          uri: "ui://widget/painter-carousel.html",
          mimeType: "text/html",
          text: createUITemplate()
        }
      }],
      structuredContent: {
        type: "painter_list",
        location: {
          postcode: args.postcode,
          suburb: args.suburb
        },
        painters: painters.map(p => ({
          id: p.id,
          name: p.name,
          owner: p.owner_name,
          rating: Number(p.star_rating || 0),
          reviews: Number(p.number_of_reviews || 0),
          jobs_won: Number(p.jobs_won || 0),
          location: {
            suburb: p.suburb,
            area: p.area,
            region: p.region
          },
          profile_url: p.ss_profile_url,
          whatsapp: p.whatsapp_number,
          score: p.score,
          engagement_rate: Number(p.engagement_rate || 0)
        })),
        total: painters.length
      },
      _meta: {
        "openai/outputTemplate": "ui://widget/painter-carousel.html",
        "openai/widgetDescription": `Showing top ${painters.length} painters in ${args.suburb || args.postcode}`,
        "openai/widgetAccessible": true
      }
    };
  } catch (error) {
    console.error("Error getting painters:", error);
    return {
      content: [{
        type: "text",
        text: `❌ Error: ${error.message}`
      }]
    };
  }
}

async function createJobRequest(args) {
  console.log("Creating job request:", args.job_title);

  // TODO: Replace with actual HubSpot API call
  const jobId = `JOB-${Date.now()}`;

  const job = {
    id: jobId,
    status: "created",
    customer: {
      name: args.customer_name,
      email: args.customer_email,
      mobile: args.customer_mobile
    },
    details: {
      title: args.job_title,
      description: args.job_description,
      location: args.location,
      job_details: args.job_details || {},
      budget: args.budget_range,
      timing: args.timing,
      site_visit_needed: args.site_visit_needed !== false
    },
    created_at: new Date().toISOString(),
    next_steps: [
      "We'll match you with up to 3 highly-rated local painters",
      "Painters will contact you within 24 hours via your preferred method",
      args.site_visit_needed !== false ? "They'll arrange a site visit to provide accurate quotes" : "You'll receive quotes based on the details provided",
      "Compare quotes and choose your preferred painter"
    ]
  };

  return {
    content: [{
      type: "text",
      text: `✅ Job Request Created!\n\nJob ID: ${jobId}\nCustomer: ${args.customer_name}\nJob: ${args.job_title}\n\nWhat's next:\n${job.next_steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}`
    }],
    structuredContent: job,
    _meta: {
      "openai/widgetDescription": "Job request successfully created"
    }
  };
}

// === MCP ENDPOINTS ===
app.post("/mcp", async (req, res) => {
  const { method, params, id } = req.body;

  console.log(`[MCP] ${method}`);

  const respond = (result, error = null) => ({
    jsonrpc: "2.0",
    id,
    ...(error ? { error } : { result })
  });

  try {
    switch (method) {
      case "initialize":
        return res.json(respond({
          protocolVersion: "2025-06-18",
          capabilities: { 
            tools: {},
            resources: {}
          },
          serverInfo: SERVER_INFO
        }));

      case "tools/list":
        return res.json(respond({ tools: TOOLS }));

      case "tools/call":
        let result;
        if (params.name === "get_top_painters") {
          result = await getTopPainters(params.arguments || {});
        } else if (params.name === "create_job_request") {
          result = await createJobRequest(params.arguments || {});
        } else {
          return res.json(respond(null, {
            code: -32602,
            message: `Unknown tool: ${params.name}`
          }));
        }
        return res.json(respond(result));

      case "resources/list":
        return res.json(respond({
          resources: [{
            uri: "ui://widget/painter-carousel.html",
            name: "Painter Carousel",
            mimeType: "text/html"
          }]
        }));

      case "resources/read":
        if (params.uri === "ui://widget/painter-carousel.html") {
          return res.json(respond({
            contents: [{
              uri: params.uri,
              mimeType: "text/html",
              text: createUITemplate()
            }]
          }));
        }
        return res.json(respond(null, {
          code: -32602,
          message: "Resource not found"
        }));

      default:
        return res.json(respond(null, {
          code: -32601,
          message: `Unknown method: ${method}`
        }));
    }
  } catch (error) {
    console.error("Error:", error);
    return res.json(respond(null, {
      code: -32603,
      message: error.message
    }));
  }
});

app.get("/health", (req, res) => {
  res.json({ 
    status: "ok",
    component: COMPONENT_JS.length > 0 ? "loaded" : "not built",
    smart_questions: SMART_QUESTIONS ? "loaded" : "not found"
  });
});

app.get("/", (req, res) => {
  res.json({
    message: "🎨 Painting Concierge MCP Server",
    tools: TOOLS.map(t => ({ name: t.name, description: t.description })),
    component_status: COMPONENT_JS ? "loaded" : "Run 'npm run build' in /web",
    smart_questions: SMART_QUESTIONS ? "loaded" : "Add smart-questions.txt to root"
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ MCP Server running on port ${PORT}`);
  console.log(`🔗 ${process.env.REPL_SLUG ? `https://${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co` : `http://localhost:${PORT}`}`);
});