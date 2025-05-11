# agent.py

import os
import asyncio
import logging
from contextlib import AsyncExitStack
from dotenv import load_dotenv
from typing import Tuple, List

from google.adk.agents.llm_agent import LlmAgent
from google.adk.agents import Agent
from google.adk.tools.mcp_tool.mcp_toolset import MCPToolset, SseServerParams
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.adk.artifacts.in_memory_artifact_service import InMemoryArtifactService

from .agent_prompts import planner_prompt, clicker_prompt, cyberchef_prompt, pentest_prompt

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Load environment variables
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "..", ".env"))

# Validate environment variables
REQUIRED_ENV_VARS = [
    "MCP_TOOLS_URL_BROWSER",
    "MCP_TOOLS_URL_PYAUTOGUI",
    "MCP_TOOLS_URL_PENTOOLS",
    "MCP_TOOLS_URL_CYBERCHEF",
]
for var in REQUIRED_ENV_VARS:
    if not os.environ.get(var):
        raise EnvironmentError(f"Missing required environment variable: {var}")

MCP_TOOLS_URLS = {
    "pyautogui": os.environ["MCP_TOOLS_URL_BROWSER"],
    # "pyautogui": os.environ["MCP_TOOLS_URL_PYAUTOGUI"],
    "cyberchef": os.environ["MCP_TOOLS_URL_CYBERCHEF"],
    "pentools": os.environ["MCP_TOOLS_URL_PENTOOLS"],
    "browser": os.environ["MCP_TOOLS_URL_BROWSER"],
}

# Shared async exit stack
common_exit_stack = AsyncExitStack()

# Global agents
root_agent = None
planner_agent = None
clicker_agent = None
cyberchef_agent = None
pentest_agent = None

model = "gemini-2.5-flash-preview-04-17"

def init_agents():
    """Initialize agents and start asynchronous setup."""
    global root_agent, planner_agent, clicker_agent, cyberchef_agent, pentest_agent

    root_agent = LlmAgent(
        model=model,
        name="planner_agent",
        instruction=planner_prompt,
        tools=[],
        sub_agents=[]
    )

    clicker_agent = LlmAgent(
        model=model,
        name="clicker_agent",
        instruction=clicker_prompt,
        tools=[],
    )

    cyberchef_agent = LlmAgent(
        model=model,
        name="cyberchef_agent",
        instruction=cyberchef_prompt,
        tools=[],
    )

    pentest_agent = LlmAgent(
        model=model,
        name="pentest_agent",
        instruction=pentest_prompt,
        tools=[],
    )

    asyncio.create_task(init_agents_async())

    return root_agent, clicker_agent, cyberchef_agent, pentest_agent

async def init_agents_async():
    """Asynchronously initialize agents with tools from MCP server."""
    global root_agent, clicker_agent, cyberchef_agent, pentest_agent

    try:
        for agent, url in zip(
            [clicker_agent, cyberchef_agent, pentest_agent, root_agent],
            MCP_TOOLS_URLS.values()
        ):
            try:
                tools, exit_stack = await get_tools_async(url)
                logger.info(f"Fetched {len(tools)} tools from MCP server for {agent.name}.")
                agent.tools = tools
                if(agent.name == "planner_agent"):
                    agent.sub_agents = [clicker_agent, pentest_agent, cyberchef_agent,]
            except Exception as e:
                logger.error(f"Error fetching MCP tools: {e}", exc_info=True)
                continue

        global _exit_stack
        _exit_stack = exit_stack

    except Exception as e:
        logger.error(f"Error initializing MCP tools: {e}", exc_info=True)

async def get_tools_async(url: str) -> Tuple[List, AsyncExitStack]:
    """Fetch tools asynchronously from the MCP server."""
    tools, exit_stack = await MCPToolset.from_server(
        connection_params=SseServerParams(url=url),
        async_exit_stack=common_exit_stack
    )

    logger.info(f"[+] Successfully connected to MCP server at {url}. Discovered {len(tools)} tool(s).")
    for tool in tools:
        logger.info(f"  - Discovered tool: {tool.name}")

    return tools, exit_stack

async def get_agents_async():
    """Creates an ADK Agent equipped with tools from the MCP Server."""
    global clicker_agent, cyberchef_agent, pentest_agent

    try:
        planner_tools, planner_exit_stack = await get_tools_async(MCP_TOOLS_URLS["browser"])
        clicker_tools, clicker_exit_stack = await get_tools_async(MCP_TOOLS_URLS["pyautogui"])
        pentest_tools, pentest_exit_stack = await get_tools_async(MCP_TOOLS_URLS["pentools"])
        cyberchef_tools, cyberchef_exit_stack = await get_tools_async(MCP_TOOLS_URLS["cyberchef"])

        clicker_agent = LlmAgent(
            model=model,
            name="clicker_agent",
            instruction=clicker_prompt,
            tools=[*clicker_tools],
        )

        cyberchef_agent = LlmAgent(
            model=model,
            name="cyberchef_agent",
            instruction=cyberchef_prompt,
            tools=[*cyberchef_tools],
        )

        pentest_agent = LlmAgent(
            model=model,
            name="pentest_agent",
            instruction=pentest_prompt,
            tools=[*pentest_tools],
        )

        agent = LlmAgent(
            model=model,
            name="planner_agent",
            instruction=planner_prompt,
            tools=[*planner_tools],
            sub_agents=[clicker_agent, cyberchef_agent, pentest_agent],
        )

        return agent, planner_exit_stack

    except Exception as e:
        logger.error(f"Error initializing agents: {e}", exc_info=True)
        raise

init_agents()

async def async_main():
    """Main asynchronous entry point."""
    session_service = InMemorySessionService()
    artifacts_service = InMemoryArtifactService()

    session = session_service.create_session(
        state={}, app_name='spectra_agent', user_id='user_0'
    )
    agent, exit_stack = await get_agents_async()

    runner = Runner(
        app_name='spectra_agent',
        agent=agent,
        artifact_service=artifacts_service,
        session_service=session_service,
    )

    try:
        logger.info("Running agent...")
        events_async = runner.run_async(
            session_id=session.id, user_id=session.user_id, new_message=content
        )

        async for event in events_async:
            logger.info(f"Event received: {event}")

    finally:
        logger.info("Closing MCP server connection...")
        await exit_stack.aclose()
        logger.info("Cleanup complete.")

if __name__ == '__main__':
    try:
        asyncio.run(async_main())
    except Exception as e:
        logger.error(f"An error occurred: {e}", exc_info=True)