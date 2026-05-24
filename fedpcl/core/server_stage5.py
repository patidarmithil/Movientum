"""
server_stage5.py
════════════════
Stage 5 server — identical to Stage 4.

LDP is applied CLIENT-SIDE before gradients/deltas reach the server,
so the server aggregation logic does not change at all.

This file simply re-exports ServerStage4 under the Stage 5 name
so the import chain stays consistent across all stages.
"""

from core.server_stage4 import ServerStage4

# Stage 5 server is exactly Stage 4 server.
# LDP happens on the client before upload — server sees only noisy values.
ServerStage5 = ServerStage4
