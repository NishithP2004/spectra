import asyncio
import base64
import io
import sys
from typing import Literal, Annotated, Any
from pydantic import Field 

try:
    from PIL import Image as PILImage
except ImportError:
    PILImage = None

if PILImage is None:
    print("Warning: Pillow (PIL) library not found.")
    print("Image-related tools (find_image_on_screen, take_screenshot) will not be available.")
    print("Install it using: pip install Pillow")

import os
import pyautogui

os.environ['DISPLAY'] = ':99'
pyautogui._pyautogui_x11._display = Xlib.display.Display(os.environ['DISPLAY'])

from fastmcp import FastMCP, Context, Image
from fastmcp.servers.context import Context 

# --- FastMCP Server Definition ---

# Instantiate the FastMCP server
# Add some instructions to guide the AI
mcp = FastMCP(
    name="PyAutoGUI Server",
    instructions="""
        This server provides tools to interact with the user interface. 
        You can move the mouse, click, type text, press hotkeys, 
        take screenshots, and find images on the screen.
        Use these tools to automate UI tasks for the user.
    """
)

# --- Tool Definitions ---

# Annotations for tools that interact with the UI (most of them)
# openWorldHint: True as they interact with the external environment (desktop UI)
# destructiveHint: True for actions that change the UI state (move, click, type, press, hotkey)
# readOnlyHint: True for actions that only read state (find, screenshot, size)

@mcp.tool(
    annotations={
        "title": "Move Mouse",
        "destructiveHint": True,
        "openWorldHint": True
    }
)
async def move_to(
    x: Annotated[int, Field(description="The x-coordinate to move to.")],
    y: Annotated[int, Field(description="The y-coordinate to move to.")]
) -> None:
    """Move the mouse cursor to the specified screen coordinates (x, y)."""
    try:
        pyautogui.moveTo(x, y)
    except Exception as e:
        # Use context for logging if needed, or just raise
        raise RuntimeError(f"Failed to move mouse to ({x}, {y}): {e}")

@mcp.tool(
    annotations={
        "title": "Click Mouse",
        "destructiveHint": True,
        "openWorldHint": True
    }
)
async def click(
    x: Annotated[int, Field(description="The x-coordinate to click at.")],
    y: Annotated[int, Field(description="The y-coordinate to click at.")],
    button: Annotated[Literal["left", "right", "middle"], Field(description="Which mouse button to click.")] = "left",
    clicks: Annotated[int, Field(description="Number of clicks.", ge=1)] = 1,
    ctx: Context | None = None # Example showing Context access
) -> None:
    """Click the mouse at the specified screen coordinates (x, y) with a specific button and number of clicks."""
    if ctx:
        await ctx.info(f"Clicking at ({x}, {y}) with {button} button, {clicks} times.")
    try:
        pyautogui.click(x, y, button=button, clicks=clicks)
    except Exception as e:
        raise RuntimeError(f"Failed to click at ({x}, {y}) with {button} button, {clicks} times: {e}")

@mcp.tool(
    annotations={
        "title": "Type Text",
        "destructiveHint": True,
        "openWorldHint": True
    }
)
async def type_text(
    text: Annotated[str, Field(description="The text to type.")],
    interval: Annotated[float, Field(description="Interval in seconds between key presses.", ge=0.0)] = 0.0
) -> None:
    """Type the given text using the keyboard."""
    try:
        pyautogui.typewrite(text, interval=interval)
    except Exception as e:
        raise RuntimeError(f"Failed to type text: {e}")

@mcp.tool(
    annotations={
        "title": "Press Key",
        "destructiveHint": True,
        "openWorldHint": True
    }
)
async def press_key(
    key: Annotated[str, Field(description="The name of the key to press (e.g., 'enter', 'esc', 'f1').")]
) -> None:
    """Press a single keyboard key."""
    # Note: Refer to pyautogui.KEYBOARD_KEYS for a list of valid key names.
    try:
        pyautogui.press(key)
    except Exception as e:
        # PyAutoGUI might raise if key name is invalid
        raise ValueError(f"Failed to press key '{key}': {e}. Ensure it's a valid key name.")

@mcp.tool(
    annotations={
        "title": "Press Hotkey",
        "destructiveHint": True,
        "openWorldHint": True
    }
)
async def press_hotkey(
    keys: Annotated[list[str], Field(description="A list of key names to press simultaneously (e.g., ['ctrl', 'c'] for copy).")]
) -> None:
    """Press a combination of keys simultaneously."""
    try:
        # pyautogui.hotkey takes *args, so we unpack the list
        pyautogui.hotkey(*keys)
    except Exception as e:
        raise ValueError(f"Failed to press hotkey combination {keys}: {e}. Ensure all key names are valid.")

@mcp.tool(
    annotations={
        "title": "Find Image on Screen",
        "readOnlyHint": True, # Does not change UI state
        "openWorldHint": True
    }
)
async def find_image_on_screen(
    image_data_base64: Annotated[str, Field(description="Base64-encoded image data (e.g., PNG, JPEG) to find on the screen.")],
    confidence: Annotated[float, Field(description="Confidence level (0.0 to 1.0) for the match.", ge=0.0, le=1.0)] = 0.9
) -> dict | None:
    """Locate the center coordinates of an image on the screen.

    Args:
        image_data_base64: Base64-encoded image data (e.g., PNG, JPEG) to find.
        confidence: Confidence level (0.0 to 1.0) for the match.

    Returns:
        A dictionary {'x': int, 'y': int} of the center coordinates if found,
        otherwise null.
    """
    if PILImage is None:
        raise RuntimeError("Pillow (PIL) library is required for this tool but not installed.")

    try:
        # Decode base64 string to bytes
        image_bytes = base64.b64decode(image_data_base64)
        
        # Open the image using Pillow from bytes
        image = PILImage.open(io.BytesIO(image_bytes))

        # Use pyautogui.locateCenterOnScreen with the Pillow image object
        # The 'grayscale=True' can sometimes improve performance but might reduce accuracy
        location = pyautogui.locateCenterOnScreen(image, confidence=confidence)

        if location is None:
            return None

        # pyautogui.locateCenterOnScreen returns a Point object with .x and .y
        return {'x': location.x, 'y': location.y}

    except base64.Error:
        raise ValueError("Invalid Base64 string provided for image data.")
    except Exception as e:
        # Catch other potential errors (PIL, pyautogui)
        raise RuntimeError(f"An error occurred while trying to find the image: {e}")

@mcp.tool(
    annotations={
        "title": "Take Screenshot",
        "readOnlyHint": True, # Does not change UI state
        "openWorldHint": True
    }
)
async def take_screenshot() -> Image:
    """Take a screenshot of the entire screen."""
    if PILImage is None:
         raise RuntimeError("Pillow (PIL) library is required for this tool but not installed.")

    try:
        # Take screenshot using pyautogui
        screenshot_pil = pyautogui.screenshot()

        # Save the Pillow image to a bytes buffer in PNG format
        buffer = io.BytesIO()
        screenshot_pil.save(buffer, format="PNG")
        img_bytes = buffer.getvalue()

        # Return as FastMCP Image object (auto-handled by FastMCP)
        return Image(data=img_bytes, format="png")

    except Exception as e:
         raise RuntimeError(f"Failed to take screenshot: {e}")

@mcp.tool(
    annotations={
        "title": "Get Screen Size",
        "readOnlyHint": True, # Does not change UI state
        "openWorldHint": True
    }
)
async def get_screen_size() -> dict:
    """Get the width and height of the main screen."""
    try:
        width, height = pyautogui.size()
        return {'width': width, 'height': height}
    except Exception as e:
        raise RuntimeError(f"Failed to get screen size: {e}")

# --- Server Entry Point ---

if __name__ == "__main__":
    # Run the server using STDIO transport, which is common for desktop clients
    # This will run the server until the process is terminated.
    # fastmcp run command will automatically find the 'mcp' object and call run()
    # mcp.run()

    # Example of running with HTTP transport instead (requires host/port)
    mcp.run(transport="sse", host="0.0.0.0", port=8922)