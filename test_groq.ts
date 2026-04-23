import { createClient, generate } from "./app/api/_lib/groqClient";
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const client = createClient(process.env.GROQ_API_KEY!);

const JSON_RULES = `Return ONLY a raw JSON object — no markdown, no code blocks, no backticks, no extra text, no commentary. Start your response with { and end with }.

The JSON must have exactly these twelve keys:
- "name": the canonical suburb name as a string
- "is_suburb": a boolean
- "summary": two honest, specific sentences
- "fun_facts": an array of exactly two strings
- "local_attractions": an array of exactly two strings
- "name_etymology": a string
- "cuisine_types": an array of exactly three strings
- "restaurant_recommendations": []
- "key_events": []
- "notable_people": []
- "heritage_sites": []
- "demographics": an object containing the following keys (or null if the DEMOGRAPHICS SOURCE is missing or contains no data):
  - "data_year": the year the data was collected as a string (e.g. "2021")
  - "data_source": the source of the data as a string (e.g. "Australian Bureau of Statistics")
  - "population": the total population as a string (e.g. "5,234")
  - "top_ancestries": an array of up to three objects, each with "name" (e.g. "English") and "percentage" as a strictly numeric value (e.g. 25.2, do NOT include the % symbol)
  - "top_languages": an array of up to three objects, each with "name" (e.g. "Mandarin") and "percentage" as a strictly numeric value (e.g. 15.0, do NOT include the % symbol)`;

const text = `DEMOGRAPHICS SOURCE (use this as the primary source for the demographics field. Do not make up statistics!):
---
According to the 2021 census conducted by the Australian Bureau of Statistics, the suburb of Parramatta had a population of 30,211. Of these:

Ethnic diversity
The most common country of birth in Parramatta is India representing 30.9% of the population, outnumbering Australian born residents at 24.8%. The next most common are China 8.9%, Nepal 5.5%, Philippines 2.5% and Iran 1.3%. However, only 6.8% identify their ancestry as Australian; the other common self-identified ancestries were Indian 27.3%, Chinese 15.3%, English 8.5% and Nepali 5.5%. About one quarter (24.4%) of people spoke English at home; other languages spoken at home included Hindi 10.4%, Mandarin 8.8%, Nepali 5.3%, Tamil 5.0% and Telugu 4.3%.
---
`;

generate(client, text + "\n\n" + JSON_RULES).then(res => console.log(res));
