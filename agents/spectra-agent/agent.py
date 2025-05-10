# agent.py

import os
import asyncio
from contextlib import AsyncExitStack
from dotenv import load_dotenv

from google.adk.agents.llm_agent import LlmAgent
from google.adk.agents import Agent
from google.adk.tools.mcp_tool.mcp_toolset import MCPToolset, SseServerParams

from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.adk.artifacts.in_memory_artifact_service import InMemoryArtifactService

# Load environment variables
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "..", ".env"))
MCP_TOOLS_URL = os.environ.get("MCP_TOOLS_URL")

# Shared async exit stack
common_exit_stack = AsyncExitStack()

root_agent = None 
browser_use_prompt = """You are a powerful AI Agent equipped with advanced browser interaction capabilities.  
Your goal is to solve the assigned task effectively by leveraging all available tools and methods. Here's how you should approach it:

1. **Devise a Clear Strategy:**  
   Begin with a detailed plan of action. Break down the task into smaller, manageable sub-problems, explain your reasoning, and outline the steps required to solve each.

2. **Maximize Tool Usage:**  
   Use all provided tools to their full potential — the browser is your workspace. Think creatively and strategically about how to interact with it.

3. **Adapt and Iterate:**  
   If a particular method fails, adapt your strategy. Try alternative approaches and continue iterating until the task is successfully completed.

4. **Engage with the UI Dynamically:**  
   You have the ability to take screenshots for better context and interact with visual UI elements using mouse events, keyboard input, and DOM selectors. Use these features to navigate and manipulate the browser environment efficiently.

5. **Solve Step-by-Step:**  
   Address each part of the task one step at a time. Validate your progress continuously and adjust your course as needed.

Remember: The browser is not just a tool — it’s your creative playground. Use it to explore, interact, and solve with precision.
"""
model = "gemini-2.5-flash-preview-04-17"

def init_agent():
    global root_agent

    root_agent = LlmAgent(
        model=model,
        name="spectra_agent",
        instruction=browser_use_prompt,
        tools=[],
    )

    asyncio.create_task(init_agent_async())

    return root_agent

async def init_agent_async():
    global root_agent

    try:
        tools, exit_stack = await get_tools_async()
        print(f"Fetched {len(tools)} tools from MCP server.")

        root_agent.tools = tools

        global _exit_stack
        _exit_stack = exit_stack

    except Exception as e:
        print(f"Error initializing MCP tools: {e}")

async def get_tools_async():
    tools, exit_stack = await MCPToolset.from_server(
        connection_params=SseServerParams(
            url=MCP_TOOLS_URL
        ),
        async_exit_stack=common_exit_stack
    )

    print(f"[+] Successfully connected to playwright-mcp server. Discovered {len(tools)} tool(s).")
    for tool in tools:
        print(f"  - Discovered tool: {tool.name}") 

    return tools, exit_stack

async def get_agent_async():
    """Creates an ADK Agent equipped with tools from the MCP Server."""
    tools, exit_stack = await get_tools_async()
    print(f"Fetched {len(tools)} tools from MCP server.")
    
    agent = LlmAgent(
        model=model,
        name="spectra_agent",
        instruction=browser_use_prompt,
        tools=[*remote_tools],
    )

    return agent, exit_stack

init_agent()

async def async_main():
    session_service = InMemorySessionService()
    artifacts_service = InMemoryArtifactService()

    session = session_service.create_session(
        state={}, app_name='spectra_agent', user_id='user_0'
    )
    agent, exit_stack = await get_agent_async()

    runner = Runner(
        app_name='spectra_agent',
        agent=agent,
        artifact_service=artifacts_service,
        session_service=session_service,
    )

    print("Running agent...")
    events_async = runner.run_async(
        session_id=session.id, user_id=session.user_id, new_message=content
    )

    async for event in events_async:
        print(f"Event received: {event}")

    print("Closing MCP server connection...")
    await exit_stack.aclose()
    print("Cleanup complete.")

if __name__ == '__main__':
    try:
        asyncio.run(async_main())
    except Exception as e:
        print(f"An error occurred: {e}")