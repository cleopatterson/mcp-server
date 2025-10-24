# Service Categories

This MCP server supports **96 service categories** with dynamic resource loading.

## How It Works

Each category can have its own:
- `resources/{category}/knowledge_base.txt` - Job scoping guide
- `resources/{category}/pricing_reference.txt` - Pricing examples
- `resources/{category}/pricing_analysis_guide.txt` - Estimation methodology

## Currently Implemented

- ✅ **painter** - Fully implemented with knowledge base and pricing

## All Available Categories

The following 96 categories are supported by the system. To activate a category, create its resource directory and files:

1. accountant
2. air_conditioning_and_heating_technician
3. app_developer
4. arborist
5. asbestos_removalist
6. asphalting_company
7. auto_electrician
8. auto_tuner
9. automatic_door_and_gate_company
10. automotive_glass_repair_company
11. bathroom_renovation_company
12. blinds_and_shutter_installer
13. bookkeeper
14. bricklayer
15. builder
16. building_designer
17. building_inspector
18. car_detailer
19. carpenter
20. carpet_cleaner
21. carpet_installer
22. celebrant
23. cleaner
24. computer_repairer_and_it_service_provider
25. concreter
26. crane_hire_company
27. demolition_company
28. dishwasher_installation_and_repair_company
29. door_installation_company
30. draftsman
31. ducting_and_ventiliation_company
32. earthworks_contractor
33. electrician
34. exterminator
35. fencing_and_gate_company
36. financial_planner
37. flooring_company
38. fridge_and_freezer_repair_and_installation_company
39. gardener
40. gas_fitter
41. glass_repair_company
42. graphic_designer
43. hair_stylist
44. handyman
45. high_pressure_cleaning_company
46. home_theatre_installation_company
47. insulation_company
48. insurance
49. interior_designer
50. kitchen_renovation_company
51. labourer
52. landscaper
53. lawyers_and_legal_professionals
54. lighting_installation_company
55. locksmith
56. make_up_artist
57. mechanic
58. musician_and_entertainer
59. oven_installation_and_repairs
60. **painter** ✅
61. paver
62. photographer
63. plasterer
64. plumber
65. pool_and_spa_company
66. printer
67. removalist
68. rendering_company
69. roofer
70. rubbish_removalist
71. scaffolding_company
72. security_company
73. shades_and_sails_company
74. sign_company
75. skylight_installation_company
76. smash_repair_company
77. solar_company
78. stonemason
79. structural_engineer
80. surveyor
81. test_and_tag_company
82. tiler
83. tv_antenna_technician
84. tv_repair_technician
85. upholsterer
86. videographer
87. washing_machine_and_dryer_technician
88. waterproofing_company
89. website_developers_and_designers
90. wedding_and_event_supplier
91. welders_and_boilermakers
92. window_and_glass_installation_company
93. window_cleaner
94. Plus 2 special categories (113, 137, sheds_and_carports)

## Activating a New Category

### Option 1: Using the Template Generator

```bash
node scripts/create_category_template.js {category_name}
```

This will create:
- `resources/{category_name}/knowledge_base.txt` (template)
- `resources/{category_name}/pricing_reference.txt` (template)
- `resources/{category_name}/pricing_analysis_guide.txt` (template)

### Option 2: Manual Creation

1. Create directory: `mkdir -p resources/{category_name}`
2. Copy templates from `resources/painting/` as a starting point
3. Customize for your category
4. Tools automatically work!

## Using Category Tools

```javascript
// Get knowledge base for any category
get_knowledge_base({ category: "plumber" })

// Get pricing guide for any category
get_pricing_guide({ category: "electrician" })
```

## Priority Categories for Implementation

Based on typical volume, prioritize:
1. ✅ Painter
2. ⏳ Plumber
3. ⏳ Electrician
4. ⏳ Carpenter
5. ⏳ Cleaner
6. ⏳ Landscaper
7. ⏳ Handyman
8. ⏳ Builder
9. ⏳ Tiler
10. ⏳ Roofer

## Data Source

Category data is auto-generated from `subcats.csv` via:
```bash
node scripts/parse_categories.js
```

This generates `category_services.json` which is loaded by the server.
