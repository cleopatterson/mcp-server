// index.js
import express from "express";
import cors from "cors";
import pg from "pg";
const { Pool } = pg;

console.log("🚀 Server starting - Version 4.0 with Database support");

const app = express();
app.use(cors());
app.use(express.json());

// --- DB pool ---
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// --- Minimal ranking helpers ---
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
      ss_profile_url, owner_name, whatsapp_number, region, area,
      star_rating::numeric as star_rating,
      jobs_won::numeric as jobs_won,
      number_of_reviews::numeric as number_of_reviews,
      engagement_rate::numeric as engagement_rate,
      rejection_rate::numeric as rejection_rate,
      coalesce(star_rating::numeric, 0)                           as quality_score,
      coalesce(1 - nullif(rejection_rate::numeric,0), 0)         as reliability_score,
      coalesce(case when number_of_reviews::numeric > 0 then 1 else 0.5 end, 0) as value_score
    from painter_list
    ${where.length ? `where ${where.join(" and ")}` : ""}
  `;

  try {
    const { rows } = await pool.query(sql, params);

    const scored = rows.map(p => {
      const q = Number(p.quality_score || 0);
      const r = Number(p.reliability_score || 0);
      const v = Number(p.value_score || 0);
      return { ...p, weights: W, score: q*W.quality + r*W.reliability + v*W.value };
    }).sort((a,b) => b.score - a.score);

    return scored.slice(0, Math.max(1, Math.min(limit, 10)));
  } catch (error) {
    console.error('Database error in rankPainters:', error);
    throw error;
  }
}

// Log all requests for debugging
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  if (req.body) {
    console.log('Body:', JSON.stringify(req.body, null, 2));
  }
  next();
});

// Simple MCP Server implementation
const mcpServer = {
  name: "painterjobs-mcp",
  version: "1.0.0"
};

// Define available tools
const tools = [
  {
    name: "test_echo",
    description: "A simple test tool that echoes a message",
    inputSchema: {
      type: "object",
      properties: {
        message: {
          type: "string",
          description: "Message to echo back",
        },
      },
      required: ["message"],
    },
  },
  {
    name: "service_seeking_price_estimator",
    description: "Estimate painting price from description (optional image URL).",
    inputSchema: {
      type: "object",
      properties: {
        description: {
          type: "string",
          description: "Job description (e.g., 'paint 2 bedroom interior')",
          minLength: 5,
        },
        image_url: {
          type: "string",
          format: "uri",
          description: "Optional image URL for the job",
        },
      },
      required: ["description"],
    },
  },
  {
    name: "service_seeking_get_job",
    description: "Fetch one job row by id from the jobs table.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Job ID to fetch",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "service_seeking_browse_jobs",
    description: "Browse rows from the jobs table with optional filters and pagination.",
    inputSchema: {
      type: "object",
      properties: {
        category: {
          type: "string",
          description: "Filter by job category",
        },
        subtype: {
          type: "string",
          description: "Filter by job subtype",
        },
        size: {
          type: "string",
          description: "Filter by job size",
        },
        min_price: {
          type: "number",
          description: "Minimum price filter",
        },
        max_price: {
          type: "number",
          description: "Maximum price filter",
        },
        q: {
          type: "string",
          description: "Search in job descriptions",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 50,
          default: 10,
          description: "Number of results to return",
        },
        offset: {
          type: "integer",
          minimum: 0,
          default: 0,
          description: "Offset for pagination",
        },
      },
    },
  },
  {
    name: "service_seeking_rank_painters",
    description: "Return a ranked shortlist. You may pass postcode to auto-resolve canonical region/area.",
    inputSchema: {
      type: "object",
      properties: {
        postcode: {
          type: "string",
          description: "Job postcode",
        },
        area: {
          type: "string",
          description: "Job area",
        },
        region: {
          type: "string",
          description: "Job region",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 10,
          default: 5,
          description: "Number of painters to return",
        },
        preferences: {
          type: "object",
          properties: {
            quality: {
              type: "number",
              minimum: 0,
              maximum: 1,
              description: "Weight for quality (0-1)",
            },
            reliability: {
              type: "number",
              minimum: 0,
              maximum: 1,
              description: "Weight for reliability (0-1)",
            },
            value: {
              type: "number",
              minimum: 0,
              maximum: 1,
              description: "Weight for value (0-1)",
            },
          },
          additionalProperties: false,
        },
      },
    },
  },
  {
    name: "painterjobs:get_painter",
    description: "Fetch a single painter by record_id.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Painter record_id (as shown in your DB/UI)",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "painterjobs:service_seeking_create_painting_job_request",
    description: "Use this when a customer wants quotes for a painting job. Ask clarifying questions about surfaces, size, budget, and timing before creating the deal. If it is a large job painters will need a site visit to give a quote, make sure to gather their availability for a visit, but smaller one room or patch up jobs don't need one. Always create/associate the customer contact with the deal so painters can reach them.",
    inputSchema: {
      type: "object",
      properties: {
        customer_name: {
          type: "string",
          minLength: 1,
          description: "Customer's full name",
        },
        customer_email: {
          type: "string",
          format: "email",
          description: "Customer's email address",
        },
        customer_mobile: {
          type: "string",
          minLength: 6,
          description: "Customer's mobile number",
        },
        dealname: {
          type: "string",
          minLength: 3,
          description: "Name for this deal/job",
        },
        job_description: {
          type: "string",
          minLength: 5,
          description: "Detailed job description",
        },
        postcode: {
          type: "string",
          description: "Job location postcode",
        },
        area: {
          type: "string",
          description: "Job area",
        },
        region: {
          type: "string",
          description: "Job region",
        },
        budget: {
          type: "string",
          description: "Customer's budget",
        },
        timing: {
          type: "string",
          description: "When the job needs to be done",
        },
        site_visit_availability: {
          type: "string",
          description: "When customer is available for site visit",
        },
        customer_type: {
          type: "string",
          description: "Type of customer (e.g., residential, commercial)",
        },
        estimate_range: {
          type: "string",
          description: "Estimated price range",
        },
        insights_or_red_flags: {
          type: "string",
          description: "Any important notes or concerns",
        },
        job_size: {
          type: "string",
          description: "Size of the job",
        },
        job_size_weight: {
          type: ["string", "number"],
          description: "Weight/importance of job size",
        },
        subtype: {
          type: "string",
          description: "Job subtype",
        },
        preferred_number_of_quotes: {
          type: "string",
          default: "3",
          description: "How many quotes customer wants",
        },
        dealstage: {
          type: "string",
          default: "81813617",
        },
        pipeline: {
          type: "string",
          default: "38341498",
        },
        state: {
          type: "string",
          default: "NSW",
        },
        associationCategory: {
          type: "string",
          enum: ["USER_DEFINED", "HUBSPOT_DEFINED"],
          default: "USER_DEFINED",
        },
        associationTypeId: {
          type: "number",
          default: 36,
        },
        hubspot_token: {
          type: "string",
          description: "HubSpot API token if needed",
        },
      },
      required: ["dealname", "job_description"],
    },
  },
  {
    name: "calculate_room_paint",
    description: "Calculate paint needed for a room",
    inputSchema: {
      type: "object",
      properties: {
        length: {
          type: "number",
          description: "Room length in meters",
        },
        width: {
          type: "number",
          description: "Room width in meters",
        },
        height: {
          type: "number",
          description: "Room height in meters",
        },
      },
      required: ["length", "width", "height"],
    },
  },
  // Pattern-Learning Job Analysis Tool
  {
    name: "analyze_job_patterns",
    description: "Analyze historical jobs to understand what questions to ask, how to classify jobs, and what details matter. This tool helps the AI learn from past successful job briefs rather than following rigid rules.",

    inputSchema: {
      type: "object",
      properties: {
        customer_description: {
          type: "string",
          description: "What the customer has said about their job so far",
          minLength: 3
        },

        known_details: {
          type: "object",
          description: "Details we've already collected",
          properties: {
            category: { type: "string" },
            subtype: { type: "string" },
            size: { type: "string" },
            rooms_mentioned: { type: "array", items: { type: "string" } },
            property_type: { type: "string" },
            other_details: { type: "object" }
          }
        },

        need_help_with: {
          type: "array",
          description: "What the AI needs help figuring out",
          items: {
            type: "string",
            enum: [
              "next_question",      // What should I ask next?
              "classification",     // What category/subtype/size is this?
              "missing_details",    // What important details am I missing?
              "price_factors",      // What affects the price for this job?
              "completion_check"    // Do I have enough info to create the brief?
            ]
          },
          default: ["next_question", "classification"]
        },

        sample_size: {
          type: "integer",
          minimum: 5,
          maximum: 50,
          default: 20,
          description: "How many similar historical jobs to analyze"
        }
      },
      required: ["customer_description", "need_help_with"]
    }
  }
];





// Tool implementations
async function handleToolCall(name, args) {
  console.log(`Calling tool: ${name} with args:`, args);

  switch (name) {
    case "test_echo":
      return {
        content: [
          {
            type: "text",
            text: `Echo: ${args.message}\nTimestamp: ${new Date().toISOString()}`,
          },
        ],
      };
      case "analyze_job_patterns":
        try {
          const { 
            customer_description, 
            known_details = {}, 
            need_help_with, 
            sample_size = 20 
          } = args;

          // Extract key signals from customer description
          const desc_lower = customer_description.toLowerCase();
          const signals = {
            has_room_count: /\b(\d+|one|two|three|four|five|six)\s*(bed|room|bedroom)/i.test(customer_description),
            has_property_type: /(house|apartment|unit|townhouse|villa)/i.test(desc_lower),
            mentions_full: /(full|entire|whole|complete)/i.test(desc_lower),
            mentions_inside: /(interior|inside|internal)/i.test(desc_lower),
            mentions_outside: /(exterior|outside|external|weatherboard|render)/i.test(desc_lower),
            specific_rooms: desc_lower.match(/(bedroom|bathroom|kitchen|living|lounge|hallway|laundry)/gi) || [],
            has_measurements: /\b\d+\s*(m|meter|metre|sqm|m2|square)/i.test(desc_lower)
          };

          // Build smart query to find similar jobs
          const searchTerms = [];
          const whereConditions = [];
          const params = [];

          // Core search - find jobs with similar descriptions
          if (customer_description.length > 10) {
            // Extract meaningful phrases for searching
            const keyPhrases = customer_description
              .replace(/[^a-zA-Z0-9\s]/g, '')
              .split(' ')
              .filter(word => word.length > 3)
              .slice(0, 5)
              .join(' ');

            params.push(`%${keyPhrases}%`);
            whereConditions.push(`(job_description_cleaned ILIKE $${params.length} OR job_description ILIKE $${params.length})`);
          }

          // If we have a suspected category, bias toward it
          if (known_details.category) {
            params.push(known_details.category);
            // Use OR to still get variety but weight toward suspected category
            whereConditions.push(`(category = $${params.length} OR category IS NOT NULL)`);
          }

          const whereSql = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

          // Get similar historical jobs
          const sql = `
            WITH ranked_jobs AS (
              SELECT 
                id,
                category,
                subtype,
                size,
                total_price,
                job_description,
                job_description_cleaned,
                keywords,
                -- Score similarity based on description overlap
                CASE 
                  WHEN job_description_cleaned ILIKE $1 THEN 3
                  WHEN job_description ILIKE $1 THEN 2
                  ELSE 1
                END as similarity_score
              FROM jobs
              ${whereSql}
              ORDER BY similarity_score DESC, id DESC
              LIMIT $${params.length + 1}
            )
            SELECT * FROM ranked_jobs
          `;

          const { rows: similarJobs } = await pool.query(sql, [...params, sample_size]);

          if (similarJobs.length < 3) {
            // Fallback to broader search if too few results
            const fallbackSql = `
              SELECT category, subtype, size, total_price, job_description, job_description_cleaned, keywords
              FROM jobs
              WHERE job_description_cleaned IS NOT NULL
              ORDER BY RANDOM()
              LIMIT $1
            `;
            const { rows: fallbackJobs } = await pool.query(fallbackSql, [sample_size]);
            similarJobs.push(...fallbackJobs);
          }

          // Analyze patterns in similar jobs
          const patterns = {
            categories: {},
            subtypes: {},
            sizes: {},
            common_details: new Set(),
            question_patterns: new Set(),
            price_ranges: { low: null, high: null, avg: null },
            detail_frequency: {}
          };

          // Process each similar job
          similarJobs.forEach(job => {
            // Count categories/subtypes/sizes
            if (job.category) patterns.categories[job.category] = (patterns.categories[job.category] || 0) + 1;
            if (job.subtype) patterns.subtypes[job.subtype] = (patterns.subtypes[job.subtype] || 0) + 1;
            if (job.size) patterns.sizes[job.size] = (patterns.sizes[job.size] || 0) + 1;

            // Extract common details from descriptions
            const jobDesc = (job.job_description_cleaned || job.job_description || '').toLowerCase();

            // Look for specific details that were captured
            if (jobDesc.includes('ceiling')) patterns.detail_frequency['ceilings'] = (patterns.detail_frequency['ceilings'] || 0) + 1;
            if (jobDesc.includes('trim') || jobDesc.includes('skirting')) patterns.detail_frequency['trims'] = (patterns.detail_frequency['trims'] || 0) + 1;
            if (jobDesc.includes('door')) patterns.detail_frequency['doors'] = (patterns.detail_frequency['doors'] || 0) + 1;
            if (jobDesc.includes('wall')) patterns.detail_frequency['walls'] = (patterns.detail_frequency['walls'] || 0) + 1;
            if (/\b\d+\s*m(eter|etre)?s?\b/.test(jobDesc)) patterns.detail_frequency['measurements'] = (patterns.detail_frequency['measurements'] || 0) + 1;
            if (/(single|double|two)[\s-]?stor/.test(jobDesc)) patterns.detail_frequency['storeys'] = (patterns.detail_frequency['storeys'] || 0) + 1;
            if (/(house|apartment|unit|townhouse)/.test(jobDesc)) patterns.detail_frequency['property_type'] = (patterns.detail_frequency['property_type'] || 0) + 1;

            // Detect question patterns based on job type
            if (job.category === 'interior') {
              if (job.size === 'small' && !signals.mentions_full) {
                patterns.question_patterns.add('confirm_specific_rooms');
              } else if (job.size === 'medium' || job.size === 'large') {
                patterns.question_patterns.add('confirm_whole_property');
                patterns.question_patterns.add('ask_property_type');
              }
            }
          });

          // Calculate price statistics
          const prices = similarJobs.map(j => j.total_price).filter(p => p != null && p > 0);
          if (prices.length > 0) {
            patterns.price_ranges.low = Math.min(...prices);
            patterns.price_ranges.high = Math.max(...prices);
            patterns.price_ranges.avg = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length);
          }

          // Build response based on what AI needs help with
          let response = {
            patterns_found: similarJobs.length,
            confidence: similarJobs.length >= 5 ? 'high' : similarJobs.length >= 3 ? 'medium' : 'low'
          };

          // 1. NEXT QUESTION RECOMMENDATION
          if (need_help_with.includes('next_question')) {
            response.next_question = {};

            // Determine what's missing based on patterns
            const detailCoverage = Object.entries(patterns.detail_frequency)
              .map(([detail, count]) => ({
                detail,
                frequency: (count / similarJobs.length) * 100
              }))
              .sort((a, b) => b.frequency - a.frequency);

            // Smart question logic based on patterns and signals
            if (signals.mentions_full && !known_details.property_type) {
              response.next_question = {
                question: "What type of property is it - house, apartment, or townhouse?",
                reason: `${detailCoverage.find(d => d.detail === 'property_type')?.frequency.toFixed(0)}% of similar 'full property' jobs specified property type`,
                options: ["House", "Apartment", "Townhouse", "Villa"]
              };
            } else if (signals.has_room_count && !signals.mentions_full && !known_details.scope_confirmed) {
              const roomCount = signals.specific_rooms.length || 'these';
              response.next_question = {
                question: `Just to confirm - is this for ${roomCount} specific rooms only, or the whole property?`,
                reason: "Similar jobs with room counts often needed this clarification",
                options: ["Just these rooms", "Whole property"]
              };
            } else if (patterns.detail_frequency['ceilings'] > similarJobs.length * 0.7 && !known_details.surfaces) {
              response.next_question = {
                question: "Does this include ceilings, trims, and doors as well as walls?",
                reason: `${detailCoverage.find(d => d.detail === 'ceilings')?.frequency.toFixed(0)}% of similar jobs specified ceiling details`,
                options: ["Walls only", "Walls and ceilings", "Everything (walls, ceilings, trims, doors)"]
              };
            } else if (patterns.detail_frequency['storeys'] > similarJobs.length * 0.5 && !known_details.storeys) {
              response.next_question = {
                question: "Is this a single or double storey property?",
                reason: `${detailCoverage.find(d => d.detail === 'storeys')?.frequency.toFixed(0)}% of similar exterior jobs specified storeys`,
                options: ["Single storey", "Double storey", "Split level"]
              };
            } else if (signals.mentions_outside && patterns.detail_frequency['measurements'] > similarJobs.length * 0.4) {
              response.next_question = {
                question: "Could you provide approximate dimensions or area to be painted?",
                reason: "Helps provide more accurate pricing for exterior work",
                type: "text"
              };
            }
          }

          // 2. CLASSIFICATION PREDICTION
          if (need_help_with.includes('classification')) {
            response.classification = {
              category: null,
              subtype: null,
              size: null,
              confidence_scores: {}
            };

            // Predict category
            if (Object.keys(patterns.categories).length > 0) {
              const totalCat = Object.values(patterns.categories).reduce((a, b) => a + b, 0);
              const catPredictions = Object.entries(patterns.categories)
                .map(([cat, count]) => ({ 
                  category: cat, 
                  probability: (count / totalCat * 100).toFixed(0) + '%' 
                }))
                .sort((a, b) => parseInt(b.probability) - parseInt(a.probability));

              response.classification.category = catPredictions[0].category;
              response.classification.confidence_scores.category = catPredictions;
            }

            // Predict size based on signals and patterns
            if (Object.keys(patterns.sizes).length > 0) {
              const totalSize = Object.values(patterns.sizes).reduce((a, b) => a + b, 0);
              const sizePredictions = Object.entries(patterns.sizes)
                .map(([size, count]) => ({ 
                  size, 
                  probability: (count / totalSize * 100).toFixed(0) + '%' 
                }))
                .sort((a, b) => parseInt(b.probability) - parseInt(a.probability));

              // Adjust based on signals
              if (signals.specific_rooms.length === 1) {
                response.classification.size = 'small';
                response.classification.confidence_scores.size_override = "Single room mentioned → small";
              } else if (signals.specific_rooms.length >= 2 && signals.specific_rooms.length <= 4) {
                response.classification.size = 'medium';
                response.classification.confidence_scores.size_override = `${signals.specific_rooms.length} rooms mentioned → medium`;
              } else {
                response.classification.size = sizePredictions[0].size;
                response.classification.confidence_scores.size = sizePredictions;
              }
            }
          }

          // 3. MISSING DETAILS CHECK
          if (need_help_with.includes('missing_details')) {
            const criticalDetails = [];

            // Check what's commonly specified but missing here
            Object.entries(patterns.detail_frequency).forEach(([detail, count]) => {
              const frequency = (count / similarJobs.length) * 100;
              if (frequency > 50 && !known_details[detail]) {
                criticalDetails.push({
                  detail,
                  frequency: frequency.toFixed(0) + '%',
                  importance: frequency > 80 ? 'critical' : frequency > 60 ? 'important' : 'useful'
                });
              }
            });

            response.missing_details = criticalDetails.sort((a, b) => parseInt(b.frequency) - parseInt(a.frequency));
          }

          // 4. PRICE FACTORS
          if (need_help_with.includes('price_factors') && patterns.price_ranges.avg) {
            response.price_estimate = {
              range: `$${Math.round(patterns.price_ranges.low)} - $${Math.round(patterns.price_ranges.high)}`,
              average: `$${patterns.price_ranges.avg}`,
              based_on: `${prices.length} similar jobs`,
              factors: []
            };

            // Identify price-influencing factors
            if (patterns.sizes.large > patterns.sizes.small) {
              response.price_estimate.factors.push("Size significantly affects price");
            }
            if (patterns.detail_frequency.ceilings > similarJobs.length * 0.5) {
              response.price_estimate.factors.push("Including ceilings adds 20-30% to cost");
            }
          }

          // 5. COMPLETION CHECK
          if (need_help_with.includes('completion_check')) {
            const required = ['category', 'size'];
            const nice_to_have = ['property_type', 'surfaces', 'timing'];

            const missing_required = required.filter(field => !known_details[field] && !response.classification?.[field]);
            const missing_nice = nice_to_have.filter(field => !known_details[field]);

            response.completion_status = {
              ready: missing_required.length === 0,
              missing_required,
              missing_nice,
              recommendation: missing_required.length === 0 
                ? "You have enough information to create a job brief" 
                : `Still need: ${missing_required.join(', ')}`
            };
          }

          // Format the response for the AI
          let formattedResponse = `📊 **Analysis of ${similarJobs.length} Similar Jobs**\n\n`;

          if (response.classification) {
            formattedResponse += `**📋 Classification Prediction:**\n`;
            formattedResponse += `• Category: ${response.classification.category} (${response.classification.confidence_scores.category?.[0]?.probability || 'uncertain'})\n`;
            formattedResponse += `• Size: ${response.classification.size}${response.classification.confidence_scores.size_override ? ` (${response.classification.confidence_scores.size_override})` : ''}\n\n`;
          }

          if (response.next_question) {
            formattedResponse += `**❓ Recommended Next Question:**\n`;
            formattedResponse += `"${response.next_question.question}"\n`;
            formattedResponse += `Reason: ${response.next_question.reason}\n`;
            if (response.next_question.options) {
              formattedResponse += `Options: ${response.next_question.options.join(', ')}\n`;
            }
            formattedResponse += '\n';
          }

          if (response.missing_details) {
            formattedResponse += `**🔍 Commonly Captured Details You're Missing:**\n`;
            response.missing_details.forEach(detail => {
              formattedResponse += `• ${detail.detail}: ${detail.frequency} of similar jobs (${detail.importance})\n`;
            });
            formattedResponse += '\n';
          }

          if (response.price_estimate) {
            formattedResponse += `**💰 Price Intelligence:**\n`;
            formattedResponse += `• Range: ${response.price_estimate.range}\n`;
            formattedResponse += `• Average: ${response.price_estimate.average}\n`;
            formattedResponse += `• Based on: ${response.price_estimate.based_on}\n`;
            response.price_estimate.factors.forEach(factor => {
              formattedResponse += `• ${factor}\n`;
            });
            formattedResponse += '\n';
          }

          if (response.completion_status) {
            formattedResponse += `**✅ Completion Status:**\n`;
            formattedResponse += response.completion_status.recommendation + '\n';
          }

          // Add raw JSON for AI to process
          formattedResponse += `\n<json_data>\n${JSON.stringify(response, null, 2)}\n</json_data>`;

          return {
            content: [{
              type: "text",
              text: formattedResponse
            }]
          };

        } catch (error) {
          console.error('Pattern analysis error:', error);
          return {
            content: [{
              type: "text",
              text: `❌ Error analyzing patterns: ${error.message}\n\nFalling back to standard questions.`
            }]
          };
        }

      
    case "service_seeking_price_estimator":
      const description = args.description.toLowerCase();
      let basePrice = 500;
      let days = 1;

      // Simple keyword-based pricing
      if (description.includes("room") || description.includes("bedroom")) {
        basePrice += 300;
        days = 1;
      }
      if (description.includes("2") || description.includes("two")) {
        basePrice += 300;
        days = 2;
      }
      if (description.includes("3") || description.includes("three")) {
        basePrice += 600;
        days = 3;
      }
      if (description.includes("house") || description.includes("home")) {
        basePrice += 2000;
        days = 5;
      }
      if (description.includes("exterior") || description.includes("outside")) {
        basePrice += 1500;
        days += 2;
      }
      if (description.includes("ceiling")) {
        basePrice += 200;
      }
      if (description.includes("apartment") || description.includes("unit")) {
        basePrice += 1000;
        days = 3;
      }

      const minPrice = Math.round(basePrice * 0.8);
      const maxPrice = Math.round(basePrice * 1.2);

      let priceResponse = `🎨 Painting Price Estimate\n`;
      priceResponse += `━━━━━━━━━━━━━━━━━━━━\n`;
      priceResponse += `Description: ${args.description}\n`;
      if (args.postcode) {
        priceResponse += `Location: Postcode ${args.postcode}\n`;
      }
      priceResponse += `\n💰 Estimated Price Range: $${minPrice} - $${maxPrice}\n`;
      priceResponse += `⏱️ Estimated Duration: ${days} day${days > 1 ? 's' : ''}\n`;
      priceResponse += `\n📝 Note: This is a rough estimate. Actual prices vary based on:\n`;
      priceResponse += `• Surface preparation needed\n`;
      priceResponse += `• Paint quality selected\n`;
      priceResponse += `• Accessibility and room layout\n`;
      priceResponse += `• Current condition of surfaces`;

      return {
        content: [
          {
            type: "text",
            text: priceResponse,
          },
        ],
      };

    case "service_seeking_get_job":
      try {
        const { rows } = await pool.query(
          `SELECT * FROM jobs WHERE id = $1`,
          [args.id]
        );

        if (!rows.length) {
          return {
            content: [{
              type: "text",
              text: `❌ No job found with ID: ${args.id}`
            }]
          };
        }

        const job = rows[0];
        return {
          content: [{
            type: "text",
            text: `📋 Job ${job.id}
Category: ${job.category || "—"}
Subtype: ${job.subtype || "—"}
Size: ${job.size || "—"}
Price: ${job.total_price ? `$${Math.round(job.total_price)}` : "—"}

Description:
${job.job_description_cleaned || job.job_description || "No description"}

JSON:
\`\`\`json
${JSON.stringify(job, null, 2)}
\`\`\``,
          }]
        };
      } catch (error) {
        console.error('Database error:', error);
        return {
          content: [{
            type: "text",
            text: `❌ Database error: ${error.message}`
          }]
        };
      }

    case "service_seeking_browse_jobs":
      try {
        const where = [];
        const params = [];
        const add = (sql, val) => { 
          params.push(val); 
          where.push(sql.replace("$$", `$${params.length}`)); 
        };

        if (args.category)  add(`category = $$`, args.category);
        if (args.subtype)   add(`subtype = $$`, args.subtype);
        if (args.size)      add(`size = $$`, args.size);
        if (args.min_price != null) add(`total_price >= $$`, args.min_price);
        if (args.max_price != null) add(`total_price <= $$`, args.max_price);
        if (args.q)         add(`COALESCE(job_description_cleaned, job_description) ILIKE $$`, `%${args.q}%`);

        const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
        const limit = args.limit || 10;
        const offset = args.offset || 0;

        const sql = `
          SELECT id, category, subtype, size, total_price, job_description, job_description_cleaned
          FROM jobs
          ${whereSql}
          ORDER BY id DESC
          LIMIT $${params.length + 1} OFFSET $${params.length + 2}
        `;

        const { rows } = await pool.query(sql, [...params, limit, offset]);

        if (!rows.length) {
          return {
            content: [{
              type: "text",
              text: `🗂️ Jobs (limit=${limit} offset=${offset}) — 0 rows

Tips:
• Remove filters (category/subtype/size/min/max/q) to check if table has data
• Try browsing without any filters first

JSON:
\`\`\`json
[]
\`\`\``
            }]
          };
        }

        const lines = rows.map(j => {
          const priceText = (j.total_price != null && !Number.isNaN(j.total_price))
            ? `$${Math.round(Number(j.total_price))}`
            : "—";
          const descSrc = j.job_description_cleaned ?? j.job_description ?? "";
          const snippet = descSrc.slice(0, 100);
          return `Job ${j.id} — ${j.category ?? "—"}/${j.subtype ?? "—"}/${j.size ?? "—"} — ${priceText}
${snippet}${descSrc.length > 100 ? "…" : ""}`;
        });

        return {
          content: [{
            type: "text",
            text: `🗂️ Jobs (limit=${limit} offset=${offset})
${lines.join("\n\n")}

JSON:
\`\`\`json
${JSON.stringify(rows, null, 2)}
\`\`\``
          }]
        };
      } catch (error) {
        console.error('Database error:', error);
        return {
          content: [{
            type: "text",
            text: `❌ Database error: ${error.message}`
          }]
        };
      }

    case "service_seeking_rank_painters":
      try {
        const ranked = await rankPainters({
          suburb: args.suburb,
          postcode: args.postcode,
          area: args.area,
          region: args.region,
          limit: args.limit || 5,
          weights: args.preferences || {}
        });

        if (!ranked.length) {
          return {
            content: [{
              type: "text",
              text: `❌ No painters found for the specified location`
            }]
          };
        }

        const lines = ranked.map((p, i) => 
          `${i+1}. ${p.name} (ID: ${p.id})
   ⭐ ${p.star_rating || 0} stars | ${p.number_of_reviews || 0} reviews
   🏆 ${p.jobs_won || 0} jobs won | Score: ${p.score.toFixed(3)}
   📍 ${p.area}, ${p.region}`
        );

        return {
          content: [{
            type: "text",
            text: `🎯 Top ${ranked.length} Painters
${lines.join("\n\n")}

Ranking Weights:
• Quality: ${(ranked[0].weights.quality * 100).toFixed(0)}%
• Reliability: ${(ranked[0].weights.reliability * 100).toFixed(0)}%
• Value: ${(ranked[0].weights.value * 100).toFixed(0)}%

JSON:
\`\`\`json
${JSON.stringify(ranked, null, 2)}
\`\`\``
          }]
        };
      } catch (error) {
        console.error('Database error:', error);
        return {
          content: [{
            type: "text",
            text: `❌ Database error: ${error.message}`
          }]
        };
      }

    case "painterjobs:get_painter":
      try {
        const { rows } = await pool.query(
          `SELECT * FROM painter_list WHERE record_id = $1`,
          [args.id]
        );

        if (!rows.length) {
          return {
            content: [{
              type: "text",
              text: `❌ No painter found with ID: ${args.id}`
            }]
          };
        }

        const painter = rows[0];
        return {
          content: [{
            type: "text",
            text: `👷 ${painter.company_name}
Owner: ${painter.owner_name || "—"}
📍 ${painter.area}, ${painter.region}
⭐ ${painter.star_rating || 0} stars (${painter.number_of_reviews || 0} reviews)
🏆 ${painter.jobs_won || 0} jobs won
📞 WhatsApp: ${painter.whatsapp_number || "—"}
🔗 Profile: ${painter.ss_profile_url || "—"}

Engagement Rate: ${painter.engagement_rate || 0}%
Rejection Rate: ${painter.rejection_rate || 0}%

JSON:
\`\`\`json
${JSON.stringify(painter, null, 2)}
\`\`\``
          }]
        };
      } catch (error) {
        console.error('Database error:', error);
        return {
          content: [{
            type: "text",
            text: `❌ Database error: ${error.message}`
          }]
        };
      }

    case "painterjobs:service_seeking_create_painting_job_request":
      // This would typically integrate with HubSpot or Service Seeking API
      // For now, returning a mock response
      return {
        content: [{
          type: "text",
          text: `✅ Job Request Created

Customer: ${args.customer_name}
Email: ${args.customer_email}
Mobile: ${args.customer_mobile}

Job: ${args.dealname}
Description: ${args.job_description}
Location: ${args.postcode || "Not specified"}
Budget: ${args.budget || "Not specified"}
Timing: ${args.timing || "Not specified"}

Note: In production, this would create a deal in HubSpot/Service Seeking`
        }]
      };

    case "calculate_room_paint":
      const { length, width, height } = args;

      // Calculate wall area (perimeter × height minus standard door/window area)
      const perimeter = 2 * (parseFloat(length) + parseFloat(width));
      const wallArea = perimeter * parseFloat(height);
      const doorWindowArea = 4; // Approximate m² for standard door and window
      const paintableArea = wallArea - doorWindowArea;

      // Calculate ceiling area
      const ceilingArea = parseFloat(length) * parseFloat(width);

      // Paint coverage (1 liter typically covers 10m² for one coat)
      const coveragePerLiter = 10;
      const coats = 2;

      const wallPaintNeeded = (paintableArea * coats) / coveragePerLiter;
      const ceilingPaintNeeded = (ceilingArea * coats) / coveragePerLiter;

      let calculatorResponse = `🎨 Paint Calculator Results\n`;
      calculatorResponse += `━━━━━━━━━━━━━━━━━━━━\n`;
      calculatorResponse += `Room Dimensions: ${length}m × ${width}m × ${height}m\n\n`;
      calculatorResponse += `📐 Areas:\n`;
      calculatorResponse += `• Wall area: ${paintableArea.toFixed(1)}m²\n`;
      calculatorResponse += `• Ceiling area: ${ceilingArea.toFixed(1)}m²\n\n`;
      calculatorResponse += `🪣 Paint Required (2 coats):\n`;
      calculatorResponse += `• Walls: ${Math.ceil(wallPaintNeeded)} liters\n`;
      calculatorResponse += `• Ceiling: ${Math.ceil(ceilingPaintNeeded)} liters\n`;
      calculatorResponse += `• Total: ${Math.ceil(wallPaintNeeded + ceilingPaintNeeded)} liters\n\n`;
      calculatorResponse += `💡 Tip: Add 10% extra for touch-ups and future maintenance`;

      return {
        content: [
          {
            type: "text",
            text: calculatorResponse,
          },
        ],
      };

    default:
      return {
        error: `Unknown tool: ${name}`,
      };
  }
}

// Main MCP endpoint - handle both GET and POST
app.all("/mcp", async (req, res) => {
  try {
    // Handle GET requests
    if (req.method === 'GET') {
      console.log("GET /mcp - returning tools list");
      return res.json({ 
        tools: tools,
        server: mcpServer.name,
        version: mcpServer.version
      });
    }

    // Handle POST requests with JSONRPC format
    const { method, params, jsonrpc, id } = req.body || {};

    console.log(`MCP POST Request: ${method}`);
    if (params) {
      console.log('Parameters:', JSON.stringify(params, null, 2));
    }

    // Helper to build JSONRPC response
    const jsonrpcResponse = (result, error = null) => {
      const response = {
        jsonrpc: "2.0",
        id: id !== undefined ? id : null
      };

      if (error) {
        response.error = {
          code: -32603,
          message: error
        };
      } else {
        response.result = result;
      }

      return response;
    };

    switch (method) {
      case "initialize":
        console.log("Handling initialize request - sending JSONRPC response");
        return res.json(jsonrpcResponse({
          protocolVersion: "2025-06-18",
          capabilities: {
            tools: {}
          },
          serverInfo: {
            name: mcpServer.name,
            version: mcpServer.version
          }
        }));

      case "tools/list":
        console.log("Handling tools/list request");
        return res.json(jsonrpcResponse({
          tools: tools
        }));

      case "tools/call":
        console.log("Handling tools/call request");
        const toolParams = params || {};
        const result = await handleToolCall(
          toolParams.name, 
          toolParams.arguments || {}
        );
        if (result.error) {
          return res.json(jsonrpcResponse(null, result.error));
        }
        return res.json(jsonrpcResponse(result));

      case "ping":
        console.log("Handling ping request");
        return res.json(jsonrpcResponse({ 
          pong: true, 
          timestamp: new Date().toISOString() 
        }));

      default:
        console.log(`Unknown method: ${method}`);
        return res.json(jsonrpcResponse(null, `Unsupported method: ${method}`));
    }
  } catch (error) {
    console.error("MCP request error:", error);
    const errorResponse = {
      jsonrpc: "2.0",
      id: req.body?.id || null,
      error: {
        code: -32603,
        message: error.message || "Internal server error"
      }
    };
    res.status(500).json(errorResponse);
  }
});

// Additional endpoints Voiceflow might try
app.post("/", async (req, res) => {
  console.log("POST to root / - redirecting to /mcp");
  req.url = '/mcp';
  app.handle(req, res);
});

// OPTIONS for CORS preflight
app.options("*", (req, res) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");
  res.sendStatus(200);
});

// Health check endpoint
app.get("/health", async (req, res) => {
  let dbStatus = "unknown";
  try {
    await pool.query('SELECT 1');
    dbStatus = "connected";
  } catch (error) {
    dbStatus = "error: " + error.message;
  }

  res.json({ 
    status: "ok", 
    server: mcpServer.name, 
    version: mcpServer.version,
    timestamp: new Date().toISOString(),
    tools_count: tools.length,
    database: dbStatus
  });
});

// Root endpoint with API documentation
app.get("/", (req, res) => {
  res.json({
    message: "🎨 PainterJobs MCP Server with Database (JSONRPC)",
    version: mcpServer.version,
    protocolVersion: "2025-06-18",
    endpoints: {
      "GET /": "This documentation",
      "GET /health": "Health check (includes database status)",
      "POST /mcp": "MCP JSONRPC endpoint",
    },
    tools: tools.map(t => ({
      name: t.name,
      description: t.description
    })),
    test_jsonrpc: {
      initialize: {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "test", version: "1.0" }
        }
      },
      list_tools: {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list"
      },
      browse_jobs: {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "service_seeking_browse_jobs",
          arguments: { limit: 5 }
        }
      },
      rank_painters: {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: {
          name: "service_seeking_rank_painters",
          arguments: { postcode: "2000", limit: 3 }
        }
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ MCP Server with Database (JSONRPC) running on port ${PORT}`);
  console.log(`📍 Server URL: ${process.env.REPL_SLUG ? `https://${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co` : `http://localhost:${PORT}`}`);
  console.log(`📍 Check health: ${process.env.REPL_SLUG ? `https://${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co` : `http://localhost:${PORT}`}/health`);
  console.log(`📊 Database URL: ${process.env.DATABASE_URL ? 'Configured' : 'Not configured'}`);
});