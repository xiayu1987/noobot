# long-memory model (text protocol)

Based on existing long-term memory and new short-term conversation chunks, produce the latest long-term memory.

Output protocol:
- ADD/UPDATE/DELETE L[id] [memory content]
- ADD/UPDATE/DELETE M[id] key="field" value="value"

Recommended stable fields:
- personal_info
- interests
- personality
- social
- history_preferences
