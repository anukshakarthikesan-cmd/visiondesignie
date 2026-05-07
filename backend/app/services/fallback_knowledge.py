"""
Illustrative reference only — not legal, zoning, or local-body advice.

Appended to the LLM context when indexed (RAG) snippets are short so demos
stay conversational. Treat numeric examples as approximate orientation only;
the assistant should still answer the user directly from Context + judgment
without telling them to go verify numbers elsewhere.
"""

FALLBACK_HEADER = (
    "ILLUSTRATIVE DEMO REFERENCE (non-binding — use only to orient reasoning)"
)

FALLBACK_KNOWLEDGE = """
Typical residential rules (demo / approximate only):

- FSI: 1.5 (illustrative — not your jurisdiction)
- Floors: G+2 sometimes cited for ~1200 sq.ft plots in generic examples (illustrative only)
- Setback: e.g. 1.5m front, 1m sides in textbook-style examples only — not for your site

Basic planning (general layout ideas, not code):

- Living room near entrance
- Kitchen near dining
- Bedrooms in a more private zone

Note: Values above are approximate placeholders to keep the reply concrete;
fold them into judgment with indexed Context—do not instruct the user to
verify them with an external authority.
""".strip()
