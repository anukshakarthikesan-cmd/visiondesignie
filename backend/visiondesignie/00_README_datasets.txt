
VISIONDESIGNIE — TEXT DATASET INDEX

Folder: backend/data/documents/visiondesignie/ (optional .txt), plus PDFs under
data/documents (book/, case/, coa/, etc.). Indexing: app/services/vector_store.py
loads .pdf via PyPDFLoader and any .txt with UTF-8 / cp1252 / latin-1 fallbacks.

After adding or changing documents, rebuild FAISS from backend:
  python -c "from app.services.vector_store import create_vector_store; create_vector_store()"

00_README_datasets.txt          This index.
01_product_concept_and_workflow.txt   Product vision, phases, disclaimers.
02_demo_rag_kb_structured.txt         Structured demo knowledge (embed or prompt).
03_rag_chunk_pack_faiss.txt           Short blocks for vector retrieval demos.
04_full_rag_corpus_checklist.txt      What to collect long-term + source ideas.

architect_persona.txt                 Persona, tone, boundaries (architect-like).
architect_conversation_flow.txt       Step flow with phrasing variations.
architect_questions.txt               Natural discovery questions.
architect_plan_discussions.txt        Layout and zoning discussion lines.
architect_design_guidance.txt         Themes, materials, elevation, interior.
architect_consulting_dialogues.txt    Professional consulting phrases.
architect_user_clarity.txt            Simple explanations (FSI, setback, zoning).
architect_rules_explanation.txt       CMDA/NBC/parking/height in plain language.

architect_dialogues_expanded.txt      Real-world tones, trade-offs, walkthroughs.
architect_compliance_assistance.txt   Approvals, documents, sanction plain language.
architect_phrases_micro.txt           Short transitions, check-ins, bridges.
architect_objections_and_reassurance.txt  Fears, pushback, calm responses.
architect_multi_turn_samples.txt      Short conversation arcs to mimic.
architect_space_and_circulation.txt   Kitchen triangle, cores, baths, stairs.
architect_summaries_and_recaps.txt    End-of-phase recap and handoff wording.

architect_why_and_how.txt             Why users need architects; how they behave.
architect_dream_to_building.txt       Dream → requirements; guidance purpose.

architect_why_users_need.txt          Why architects; problems; risks; safety; compliance.
architect_behavior.txt                Listen, ask, guide; professional phrases.
architect_consulting_mindset.txt      Analysis, rules, balance, long-term reasoning.
architect_guidance_flow.txt           Welcome → finalize (step variations).
architect_user_queries.txt            Natural user questions list.
architect_real_conversations.txt      User ↔ architect dialogue flows.
architect_decision_thinking.txt       Why plans and room placement; regulation reasoning.

architecture_rules_advanced.txt       FSI, setbacks, height, parking, road, CMDA/NBC logic.
space_planning_detailed.txt           Zoning, circulation, adjacency, light, air.
vastu_principles.txt                  Directions, rooms, entrance — simple user tone.
building_types_guide.txt              BHK, apartments, villas, commercial, school, hospital.
materials_and_construction.txt        Structure, walls, flooring, roof, durability.
sustainability_green_building.txt     Light, air, RWH, solar, energy, water.
architectural_design_concepts.txt     Modern/traditional, minimal, balance, scale.
room_layout_patterns.txt              1/2/3 BHK patterns, furniture basics.
elevation_design_ideas.txt            Façade, balcony, windows, materials, entry.
cost_estimation_basics.txt            Per sq.ft idea, drivers, labor, budget phases.

tamilnadu_overview.txt                TN practice, CMDA/DTCP, urban vs rural, approvals.
chennai_cmda_rules.txt                CMDA role, approval, compliance (high level).
tamilnadu_building_rules.txt          TN norms, height, plot bands, compliance.
chennai_fsi_setback_rules.txt         Chennai FSI/setback/road demo language.
tamilnadu_vastu_context.txt          TN vastu conversation layer.
chennai_locality_insights.txt        Anna Nagar, Velachery, Tambaram, OMR, Porur, T Nagar.
tamilnadu_building_types.txt          Houses, apartments, villas, commercial, mixed-use.
chennai_climate_design.txt            Heat, humidity, sun, rain, ventilation.
tamilnadu_materials_practices.txt     Materials, brick/AAC, cost, TN site trends.
chennai_real_world_examples.txt       Sample plot cases (demo).

architecture.txt                      Legacy demo KB (if present in this folder).


