#!/usr/bin/env node

/**
 * Parse subcats.csv and generate category structure
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read CSV
const csvPath = '/Users/tonywall/Downloads/subcats.csv';
const csvContent = readFileSync(csvPath, 'utf-8');

// Parse CSV
const lines = csvContent.split('\n').slice(1); // Skip header
const categories = new Map();

lines.forEach(line => {
  if (!line.trim()) return;

  const parts = line.split(',');
  if (parts.length < 6) return;

  const subcategoryName = parts[1];
  const categoryId = parts[3];
  const categoryName = parts[4];
  const categoryDisabled = parts[5] === 'true';

  if (categoryDisabled) return; // Skip disabled categories

  if (!categories.has(categoryName)) {
    categories.set(categoryName, {
      id: categoryId,
      name: categoryName,
      subcategories: []
    });
  }

  if (subcategoryName && !categories.get(categoryName).subcategories.includes(subcategoryName)) {
    categories.get(categoryName).subcategories.push(subcategoryName);
  }
});

// Convert category names to slugs
function toSlug(name) {
  return name
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

// Generate CATEGORY_SERVICES object
const categoryServices = {};
Array.from(categories.values())
  .sort((a, b) => a.name.localeCompare(b.name))
  .forEach(cat => {
    const slug = toSlug(cat.name);
    categoryServices[slug] = cat.subcategories.sort();
  });

console.log('📊 Total categories:', categories.size);
console.log('📝 Sample categories:', Object.keys(categoryServices).slice(0, 10));

// Write to file
const outputPath = join(__dirname, '..', 'category_services.json');
writeFileSync(outputPath, JSON.stringify(categoryServices, null, 2));
console.log('✅ Written to:', outputPath);

// Generate directory structure guide
console.log('\n📁 Directory structure to create:');
console.log('resources/');
Object.keys(categoryServices).forEach(slug => {
  console.log(`  ${slug}/`);
  console.log(`    ├── knowledge_base.txt`);
  console.log(`    ├── pricing_reference.txt`);
  console.log(`    └── pricing_analysis_guide.txt`);
});

console.log(`\n🎯 Next steps:`);
console.log('1. Review category_services.json');
console.log('2. Update index.js to import this file');
console.log('3. Create resource directories for priority categories');
console.log('4. Populate knowledge bases and pricing guides');
