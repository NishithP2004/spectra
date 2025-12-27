# agent.py

import os
import asyncio
import logging
from contextlib import AsyncExitStack
from dotenv import load_dotenv

from google.adk.agents.llm_agent import LlmAgent
from google.adk.tools.mcp_tool.mcp_toolset import McpToolset
from google.adk.tools.mcp_tool.mcp_session_manager import SseServerParams
from google.adk.tools.agent_tool import AgentTool
# from google.adk.models.lite_llm import LiteLlm
from google.adk.planners import PlanReActPlanner, BuiltInPlanner
from google.genai import types

from .prompts import spectra_prompt, planner_prompt, clicker_prompt, cyberchef_prompt, pentest_prompt
from .prompts import spectra_description, planner_description, clicker_description, cyberchef_description, pentest_description

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Load environment variables
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "..", ".env"))

# Validate environment variables
REQUIRED_ENV_VARS = [
    "MCP_TOOLS_URL_BROWSER",
    "MCP_TOOLS_URL_CYBERCHEF",
    "MCP_TOOLS_URL_PENTOOLS",
]
for var in REQUIRED_ENV_VARS:
    if not os.environ.get(var):
        raise EnvironmentError(f"Missing required environment variable: {var}")

MCP_TOOLS_URLS = {
    "browser": os.environ["MCP_TOOLS_URL_BROWSER"],
    "cyberchef": os.environ["MCP_TOOLS_URL_CYBERCHEF"],
    "pentools": os.environ["MCP_TOOLS_URL_PENTOOLS"],
    "planner": os.environ["MCP_TOOLS_URL_BROWSER"]
}

# Shared async exit stack
common_exit_stack = AsyncExitStack()

# Global agents
root_agent = None
planner_agent = None
clicker_agent = None
cyberchef_agent = None
pentest_agent = None

model = os.environ.get("BASE_MODEL", "gemini-2.5-flash")

def init_agents():
    """Initialize agents and start asynchronous setup."""
    global root_agent, planner_agent, clicker_agent, cyberchef_agent, pentest_agent

    root_agent = LlmAgent(
        model=model,
        name="spectra_agent",
        description=spectra_description,
        instruction=spectra_prompt,
        tools=[],
        sub_agents=[],
        output_key="agent_response"
    )

    planner_agent = LlmAgent(
        model=model,
        name="planner_agent",
        description=planner_description,
        instruction=planner_prompt,
        planner=PlanReActPlanner(),
        # planner=BuiltInPlanner(
        #     thinking_config=types.ThinkingConfig(
        #         include_thoughts=False, thinking_budget=0
        #     )
        # ),
        tools=[],
        sub_agents=[]
    )

    clicker_agent = LlmAgent(
        # model=LiteLlm(model=vision_model),
        model=model,
        name="clicker_agent",
        description=clicker_description,
        instruction=clicker_prompt,
        planner=PlanReActPlanner(),
        # planner=BuiltInPlanner(
        #     thinking_config=types.ThinkingConfig(
        #         include_thoughts=False, thinking_budget=0
        #     )
        # ),
        tools=[],
    )

    cyberchef_agent = LlmAgent(
        model=model,
        name="cyberchef_agent",
        description=cyberchef_description,
        instruction=cyberchef_prompt,
        planner=PlanReActPlanner(),
        # planner=BuiltInPlanner(
        #     thinking_config=types.ThinkingConfig(
        #         include_thoughts=False, thinking_budget=0
        #     )
        # ),
        tools=[],
    )

    pentest_agent = LlmAgent(
        model=model,
        name="pentest_agent",
        description=pentest_description,
        instruction=pentest_prompt,
        planner=PlanReActPlanner(),
        # planner=BuiltInPlanner(
        #     thinking_config=types.ThinkingConfig(
        #         include_thoughts=False, thinking_budget=0
        #     )
        # ),
        tools=[],
    )

    asyncio.create_task(init_agents_async())

    return root_agent, planner_agent, clicker_agent, cyberchef_agent, pentest_agent

async def get_tools_async(url: str, tool_filter: list = None) -> McpToolset:
    """Fetch tools asynchronously from the MCP server."""
    tools = McpToolset(
            connection_params=SseServerParams(
                url=url, 
                headers={'Accept': 'text/event-stream'},
                timeout=120
            ),
            **({'tool_filter': tool_filter} if tool_filter else {})
        ) 

    logger.info(f"[+] Successfully connected to MCP server at {url}.")
    try:
        for tool in tools:
            logger.info(f"  - Discovered tool: {tool.name}")
    except Exception:
        logger.debug("McpToolset is not iterable or no tools to list.")

    return tools

async def init_agents_async():
    """Asynchronously initialize agents with tools from MCP server."""
    global root_agent, planner_agent, clicker_agent, cyberchef_agent, pentest_agent

    try:
        for agent, url in zip(
            [clicker_agent, cyberchef_agent, pentest_agent, planner_agent],
            MCP_TOOLS_URLS.values()
        ):
            try:
                tools = await get_tools_async(url, ["browser_screen_capture"] if agent.name == "planner_agent" else None)
                logger.info(f"Fetched tools from MCP server for {agent.name}.")

                if agent.name == "planner_agent":
                    planner_agent.tools = [
                        AgentTool(agent=clicker_agent),
                        AgentTool(agent=cyberchef_agent),
                        AgentTool(agent=pentest_agent), 
                        tools
                    ]
                else:
                    agent.tools = [tools]  # Assign McpToolset directly
            except Exception as e:
                logger.error(f"Error fetching MCP tools: {e}", exc_info=True)
                continue

        """ planner_agent.tools = [
            AgentTool(agent=clicker_agent),
            AgentTool(agent=cyberchef_agent),
            AgentTool(agent=pentest_agent)
        ] """

        root_agent.sub_agents = [planner_agent]

    except Exception as e:
        logger.error(f"Error initializing MCP tools: {e}", exc_info=True)

async def get_agents_async():
    """Creates an ADK Agent equipped with tools from the MCP Server."""
    global clicker_agent, cyberchef_agent, pentest_agent

    try:
        clicker_tools = await get_tools_async(MCP_TOOLS_URLS["browser"])
        cyberchef_tools = await get_tools_async(MCP_TOOLS_URLS["cyberchef"])
        pentest_tools = await get_tools_async(MCP_TOOLS_URLS["pentools"])
        planner_tools = await get_tools_async(MCP_TOOLS_URLS["browser"], ["browser_screen_capture"])

        clicker_agent = LlmAgent(
            # model=LiteLlm(model=vision_model),
            model=model,
            name="clicker_agent",
            description=clicker_description,
            instruction=clicker_prompt,
            planner=PlanReActPlanner(),
            # planner=BuiltInPlanner(
            #     thinking_config=types.ThinkingConfig(
            #         include_thoughts=False, thinking_budget=0
            #     )
            # ),
            tools=[clicker_tools],
        )

        cyberchef_agent = LlmAgent(
            model=model,
            name="cyberchef_agent",
            description=cyberchef_description,
            instruction=cyberchef_prompt,
            planner=PlanReActPlanner(),
            # planner=BuiltInPlanner(
            #     thinking_config=types.ThinkingConfig(
            #         include_thoughts=False, thinking_budget=0
            #     )
            # ),
            tools=[cyberchef_tools],
        )

        pentest_agent = LlmAgent(
            model=model,
            name="pentest_agent",
            description=pentest_description,
            instruction=pentest_prompt,
            planner=PlanReActPlanner(),
            # planner=BuiltInPlanner(
            #     thinking_config=types.ThinkingConfig(
            #         include_thoughts=False, thinking_budget=0
            #     )
            # ),
            tools=[pentest_tools],
        )

        planner_agent = LlmAgent(
            model=model,
            name="planner_agent",
            description=planner_description,
            instruction=planner_prompt,
            planner=PlanReActPlanner(),
            # planner=BuiltInPlanner(
            #     thinking_config=types.ThinkingConfig(
            #         include_thoughts=False, thinking_budget=0
            #     )
            # ),
            tools=[AgentTool(agent=clicker_agent), AgentTool(agent=cyberchef_agent), AgentTool(agent=pentest_agent), planner_tools]
        )

        agent = LlmAgent(
            model=model,
            name="spectra_agent",
            description=spectra_description,
            instruction=spectra_prompt,
            sub_agents=[planner_agent],
        )

        return agent

    except Exception as e:
        logger.error(f"Error initializing agents: {e}", exc_info=True)
        raise

init_agents()