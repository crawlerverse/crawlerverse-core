---
"@crawlerverse/core": patch
---

Fix TypeError when eventEmitter is undefined on deserialized GameState

When GameState is serialized/deserialized (e.g. stored in Supabase), the
GameEventEmitter class instance and EventTracking state are lost. The simulation
then crashed on `.emit()` calls. Now `simulate()` and `simulateBubble()` restore
both `eventEmitter` and `eventTracking` at their entry points if missing.
