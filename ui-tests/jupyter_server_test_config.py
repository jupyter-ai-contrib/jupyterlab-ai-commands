"""Server configuration for integration tests.

!! Never use this configuration in production because it
opens the server to the world and provide access to JupyterLab
JavaScript objects through the global window variable.
"""
import os

from jupyterlab.galata import configure_jupyter_server

configure_jupyter_server(c)

c.ServerApp.ip = os.environ.get("JL_UI_TEST_HOST", "127.0.0.1")
c.ServerApp.port = int(os.environ.get("JL_UI_TEST_PORT", "8888"))

# Uncomment to set server log level to debug level
# c.ServerApp.log_level = "DEBUG"

c.FileContentsManager.delete_to_trash = False
