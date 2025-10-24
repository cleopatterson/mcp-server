# Service Category Resources

This directory contains knowledge bases and pricing guides for each service category.

## Directory Structure

Each service category has its own folder with three required files:

```
resources/
├── painting/
│   ├── knowledge_base.txt          # Job scoping & qualification guide
│   ├── pricing_reference.txt       # Real-world pricing examples
│   └── pricing_analysis_guide.txt  # How to analyze and present estimates
├── plumbing/                        # Future category
│   ├── knowledge_base.txt
│   ├── pricing_reference.txt
│   └── pricing_analysis_guide.txt
└── electrical/                      # Future category
    ├── knowledge_base.txt
    ├── pricing_reference.txt
    └── pricing_analysis_guide.txt
```

## Adding a New Category

To add a new service category (e.g., "plumbing"):

### 1. Create Directory
```bash
mkdir resources/plumbing
```

### 2. Create Required Files

**knowledge_base.txt** - Job qualification guide
- Subcategory definitions (e.g., "Blocked Drain", "Leak Repair")
- Size determination rules (small/medium/large)
- Essential questions to ask customers
- Common ambiguities and how to resolve them

**pricing_reference.txt** - Pricing examples
- Real-world job examples with prices
- Organized by job size/complexity
- Include property type, work description, price range, duration, materials cost

**pricing_analysis_guide.txt** - Estimation methodology
- How to analyze customer jobs
- Factors that increase/decrease cost
- How to present estimates conversationally
- Example response templates

### 3. Update Service Definitions (index.js)

Add the new category's services to `CATEGORY_SERVICES`:

```javascript
const CATEGORY_SERVICES = {
  painting: [...],
  plumbing: [
    "Blocked Drain",
    "Leak Repair",
    "Tap Installation",
    "Hot Water System",
    // ...
  ]
};
```

### 4. That's It!

The tools automatically work with any category:
- `get_knowledge_base({ category: "plumbing" })`
- `get_pricing_guide({ category: "plumbing" })`

No other code changes needed!

## File Format Guidelines

### knowledge_base.txt
- Use markdown headings for sections
- Include practical examples
- Keep questions conversational
- Focus on what's unique to this category

### pricing_reference.txt
- Organize by job size/complexity
- Include all pricing factors
- Show range not single number
- Add duration and materials estimates

### pricing_analysis_guide.txt
- Explain the analysis approach
- Provide adjustment factors (+/- percentages)
- Include example responses
- Emphasize conversational tone

## Current Categories

- **painting** ✅ Complete
- **plumbing** ⏳ Coming soon
- **electrical** ⏳ Coming soon
- **landscaping** ⏳ Coming soon
