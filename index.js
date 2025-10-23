#!/usr/bin/env node

/**
 * Service Seeking MCP Server - HTTP Version
 * Express server with MCP protocol support (no MCP SDK server handlers)
 */

import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Configuration
const HUBSPOT_TOKEN = process.env.HUBSPOT_TOKEN || "";
const POSTCODE_URL = "https://raw.githubusercontent.com/cleopatterson/service_seeking/main/postcode_to_region_area.json";

// Valid service types for painting
const VALID_SERVICES = [
  "Exterior House Painting",
  "Interior House Painting", 
  "Roof Painting",
  "Wallpapering",
  "Commercial Painting",
  "Fence Painting",
  "Paint Removal",
  "House Painting",
  "Floor Painting",
  "Concrete Painting"
];

// Region mapping for expanded search
const REGION_MAPPING = {
  "Western Sydney": ["Western Sydney"],
  "Greater Sydney": ["Greater Sydney", "Northern Sydney"],
  "South Sydney": ["South Sydney", "Sydney Metro"],
  "Sydney Metro": ["Sydney Metro", "South Sydney"],
  "Northern Sydney": ["Northern Sydney", "Greater Sydney"]
};

// Define tools array for reference
const tools = [
  {
    name: "get_top_painters",
    description: "Get the top 3 painters for a specific postcode and service type. For Voiceflow: postcode comes from context variable. For ChatGPT: gather postcode from user first.",
    inputSchema: {
      type: "object",
      properties: {
        postcode: {
          type: "string",
          description: "4-digit Australian postcode",
          pattern: "^[0-9]{4}$"
        },
        service: {
          type: "string",
          description: "Exact painting service type from the valid list",
          enum: VALID_SERVICES
        },
        hubspot_token: {
          type: "string",
          description: "HubSpot API token (optional - uses HUBSPOT_TOKEN env var if not provided)"
        }
      },
      required: ["postcode", "service"]
    }
  }
];

// Resources for MCP protocol
const resources = [
  {
    uri: "painterjobs://valid-services",
    name: "Valid Painting Services",
    description: "List of exact service types that must be used with get_top_painters",
    mimeType: "application/json"
  }
];

// Tool implementation
async function getTopPainters(args) {
  const postcode = args.postcode;
  const service = args.service;
  const hubspot_token = args.hubspot_token || HUBSPOT_TOKEN;

  // Validation
  if (!postcode || !service || !hubspot_token) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            region: null,
            area: null,
            total_painters: "0",
            top_painters_json: "[]",
            top_painter_1_details: "",
            top_painter_2_details: "",
            top_painter_3_details: "",
            error: "Missing required parameters"
          }, null, 2)
        }
      ]
    };
  }

  let region = null;
  let area = null;

  // Step 1: Postcode → region/area
  try {
    const response = await fetch(POSTCODE_URL);
    if (!response.ok) throw new Error(`Failed to fetch postcode map: ${response.status}`);
    const rawText = await response.text();
    const postcodeMap = JSON.parse(rawText);

    const match = postcodeMap[postcode];
    if (!match) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              region: null,
              area: null,
              total_painters: "0",
              top_painters_json: "[]",
              top_painter_1_details: "",
              top_painter_2_details: "",
              top_painter_3_details: ""
            }, null, 2)
          }
        ]
      };
    }

    region = match.region;
    area = match.area;
  } catch (err) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            region: null,
            area: null,
            total_painters: "0",
            top_painters_json: "[]",
            top_painter_1_details: "",
            top_painter_2_details: "",
            top_painter_3_details: "",
            error: err.message
          }, null, 2)
        }
      ]
    };
  }

  // Step 2: Region mapping & HubSpot search (paginated)
  const region_list = REGION_MAPPING[region] || (region ? [region] : []);

  const filterGroups = region_list.map(region_name => ({
    filters: [
      { propertyName: "industries", operator: "CONTAINS_TOKEN", value: "painter" },
      { propertyName: "business_status", operator: "EQ", value: "active" },
      { propertyName: "region", operator: "CONTAINS_TOKEN", value: region_name },
      { propertyName: "services", operator: "CONTAINS_TOKEN", value: service }
    ]
  }));

  const PROPS = [
    "hs_object_id",
    "name",
    "region",
    "area",
    "services",
    "owner_name",
    "mobile_phone_number",
    "ss_profile_url",
    "hs_logo_url",
    "star_rating",
    "number_of_reviews",
    "review_sentiment",
    "jobs_won",
    "job_won",
    "quality_score"
  ];

  async function hsSearchPaginated() {
    const results = [];
    let after = undefined;
    while (true) {
      const body = JSON.stringify({
        filterGroups,
        properties: PROPS,
        limit: 100,
        ...(after ? { after } : {})
      });

      const res = await fetch("https://api.hubapi.com/crm/v3/objects/companies/search", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${hubspot_token}`,
          "Content-Type": "application/json"
        },
        body
      });
      if (!res.ok) throw new Error(`HubSpot search failed: ${res.status}`);
      const data = await res.json();

      if (Array.isArray(data.results)) results.push(...data.results);
      after = data.paging?.next?.after;
      if (!after) break;
    }
    return results;
  }

  let companies = [];
  try {
    companies = await hsSearchPaginated();
  } catch (err) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            region,
            area,
            total_painters: "0",
            top_painters_json: "[]",
            top_painter_1_details: "",
            top_painter_2_details: "",
            top_painter_3_details: "",
            error: `HubSpot error: ${err.message}`
          }, null, 2)
        }
      ]
    };
  }

  const total_painters = companies.length;

  // Step 3: Shape, sort by HubSpot 'quality_score' (desc)
  function getNumReviews(p) {
    const raw = p["number of reviews"] ?? p.number_of_reviews;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  }

  function getJobsWon(p) {
    const raw = p.jobs_won ?? p.job_won ?? p["jobs won"];
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  }

  function primaryPhone(p) {
    return (p.mobile_phone_number && p.mobile_phone_number.trim()) ||
           (p.mobilephone && p.mobilephone.trim()) ||
           (p.phone && p.phone.trim()) ||
           null;
  }

  const shaped = companies.map(c => {
    const p = c.properties || {};
    const q = parseFloat(p.quality_score);
    const quality = Number.isFinite(q) ? q : -Infinity;

    return {
      id: p.hs_object_id || c.id,
      company_name: p.name || "Unknown painter",
      region: p.region || null,
      area: p.area || null,
      services: p.services || null,
      owner_name: p.owner_name || "",
      phone: primaryPhone(p),
      ss_profile_url: p.ss_profile_url || null,
      hs_logo_url: p.hs_logo_url || null,
      star_rating: Number.isFinite(parseFloat(p.star_rating)) ? parseFloat(p.star_rating) : 0,
      number_of_reviews: getNumReviews(p),
      review_sentiment: p.review_sentiment || "",
      jobs_won: getJobsWon(p),
      _quality_score: quality
    };
  });

  const top3 = shaped
    .sort((a, b) => (b._quality_score - a._quality_score) || (b.number_of_reviews - a.number_of_reviews))
    .slice(0, 3)
    .map(({ _quality_score, ...rest }) => rest);

  // Step 4: Details strings for AI to verbalize
  function detailString(p) {
    return [
      `owner_name=${p.owner_name}`,
      `company_name=${p.company_name}`,
      `area=${p.area}`,
      `phone=${p.phone}`,
      `jobs_won=${p.jobs_won}`,
      `star_rating=${p.star_rating}`,
      `number_of_reviews=${p.number_of_reviews}`,
      `review_sentiment=${p.review_sentiment}`
    ].join(" | ");
  }

  const d1 = top3[0] ? detailString(top3[0]) : "";
  const d2 = top3[1] ? detailString(top3[1]) : "";
  const d3 = top3[2] ? detailString(top3[2]) : "";

  // Return outputs exactly as Voiceflow expects
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          region,
          area,
          total_painters: String(total_painters),
          top_painters_json: JSON.stringify(top3),
          top_painter_1_details: d1,
          top_painter_2_details: d2,
          top_painter_3_details: d3
        }, null, 2)
      }
    ]
  };
}

// MCP Protocol Endpoints with JSONRPC 2.0 support
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
          serverInfo: {
            name: "painterjobs-mcp",
            version: "1.0.0"
          }
        }));

      case "tools/list":
        return res.json(respond({ tools }));

      case "resources/list":
        return res.json(respond({ resources }));

      case "resources/read":
        const { uri } = params;
        if (uri === "painterjobs://valid-services") {
          return res.json(respond({
            contents: [
              {
                uri,
                mimeType: "application/json",
                text: JSON.stringify({
                  services: VALID_SERVICES,
                  note: "Service parameter must match one of these values EXACTLY"
                }, null, 2)
              }
            ]
          }));
        } else {
          return res.json(respond(null, {
            code: -32602,
            message: `Unknown resource: ${uri}`
          }));
        }

      case "tools/call":
        const { name, arguments: args } = params;
        
        if (name === "get_top_painters") {
          const result = await getTopPainters(args || {});
          return res.json(respond(result));
        } else {
          return res.json(respond(null, {
            code: -32602,
            message: `Unknown tool: ${name}`
          }));
        }

      default:
        return res.json(respond(null, {
          code: -32601,
          message: `Method not found: ${method}`
        }));
    }
  } catch (error) {
    console.error("MCP request error:", error);
    return res.json(respond(null, {
      code: -32603,
      message: error.message || "Internal server error"
    }));
  }
});

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ 
    status: "ok",
    server: "painterjobs-mcp",
    version: "1.0.0",
    timestamp: new Date().toISOString(),
    hubspot_configured: !!HUBSPOT_TOKEN
  });
});

// Root endpoint with API documentation
app.get("/", (req, res) => {
  res.json({
    message: "🎨 Painting Concierge MCP Server",
    version: "1.0.0",
    tools: tools.map(t => ({ name: t.name, description: t.description })),
    resources: resources.map(r => ({ uri: r.uri, name: r.name })),
    valid_services: VALID_SERVICES,
    endpoints: {
      "GET /": "This documentation",
      "GET /health": "Health check",
      "POST /mcp": "MCP protocol endpoint"
    },
    example: {
      method: "POST",
      url: "/mcp",
      body: {
        method: "tools/call",
        params: {
          name: "get_top_painters",
          arguments: {
            postcode: "2093",
            service: "Interior House Painting"
          }
        }
      }
    }
  });
});

// Start HTTP server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ MCP Server running on port ${PORT}`);
  console.log(`📍 Server URL: ${process.env.REPL_SLUG ? `https://${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co` : `http://localhost:${PORT}`}`);
  console.log(`📍 Check health: ${process.env.REPL_SLUG ? `https://${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co` : `http://localhost:${PORT}`}/health`);
});
