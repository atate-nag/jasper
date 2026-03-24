import { config } from 'dotenv';
config({ path: '.env.local' });

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import yaml from 'js-yaml';
import { createClient } from '@supabase/supabase-js';

interface PolicyYaml {
  id: string;
  name: string;
  posture_class: string;
  relational_depth_range: string[];
  system_prompt_fragment: string;
  response_structure: Record<string, unknown>;
  constraints: Record<string, unknown>;
}

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    console.error('Missing SUPABASE env vars');
    process.exit(1);
  }

  const supabase = createClient(url, key);
  const policyDir = join(process.cwd(), 'docs', 'policies');
  const files = readdirSync(policyDir).filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));

  console.log(`Found ${files.length} policy files`);

  for (const file of files) {
    const content = readFileSync(join(policyDir, file), 'utf-8');
    const policy = yaml.load(content) as PolicyYaml;

    const { error } = await supabase.from('policy_library').upsert({
      id: policy.id,
      name: policy.name,
      posture_class: policy.posture_class,
      relational_depth_range: policy.relational_depth_range,
      system_prompt_fragment: policy.system_prompt_fragment,
      response_structure: policy.response_structure,
      constraints: policy.constraints,
      version: 1,
      active: true,
    }, { onConflict: 'id' });

    if (error) {
      console.error(`  FAILED: ${file} — ${error.message}`);
    } else {
      console.log(`  OK: ${policy.id}`);
    }
  }

  console.log('Done.');
}

main();
