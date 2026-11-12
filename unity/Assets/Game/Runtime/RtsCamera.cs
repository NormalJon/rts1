using UnityEngine;
using UnityEngine.InputSystem;

namespace Rts.Game
{
    /// <summary>
    /// The view from above. The camera looks north and down at a fixed angle,
    /// at a point on the ground, from a distance; it never turns. Arrow keys or
    /// W A S D move it, the wheel zooms, and holding the middle button drags
    /// the ground about.
    /// </summary>
    [RequireComponent(typeof(Camera))]
    public sealed class RtsCamera : MonoBehaviour
    {
        /// <summary>Radians above the horizon: a little under 55 degrees.</summary>
        public const float PITCH = 0.96f;
        public const float MIN_DISTANCE = 22f;
        public const float MAX_DISTANCE = 190f;

        /// <summary>What the camera looks at, in tiles, and how far back it sits, in metres.</summary>
        public float targetX;
        public float targetY;
        public float distance = 62f;
        /// <summary>Whether the keyboard and mouse move it. Off when something else is driving.</summary>
        public bool takesInput = true;

        Ground ground;
        Camera lens;

        void Awake()
        {
            lens = GetComponent<Camera>();
            lens.fieldOfView = 30f;
            lens.nearClipPlane = 2f;
            lens.farClipPlane = 2500f;
            lens.clearFlags = CameraClearFlags.SolidColor;
            lens.backgroundColor = Palette.BACKGROUND;
        }

        public void Attach(Ground ground)
        {
            this.ground = ground;
            targetX = ground.map.width / 2f;
            targetY = ground.map.height / 2f;
            Place();
        }

        public void LookAt(float x, float y)
        {
            targetX = x;
            targetY = y;
            Place();
        }

        void LateUpdate()
        {
            if (ground == null) return;
            if (takesInput) ReadInput(Mathf.Min(0.1f, Time.unscaledDeltaTime));
            Place();
        }

        void ReadInput(float dt)
        {
            Keyboard keys = Keyboard.current;
            if (keys != null)
            {
                float right = (keys.rightArrowKey.isPressed || keys.dKey.isPressed ? 1f : 0f) - (keys.leftArrowKey.isPressed || keys.aKey.isPressed ? 1f : 0f);
                float south = (keys.downArrowKey.isPressed || keys.sKey.isPressed ? 1f : 0f) - (keys.upArrowKey.isPressed || keys.wKey.isPressed ? 1f : 0f);
                // Moving by a share of what is on screen feels the same at any zoom.
                float reach = distance * 1.1f * dt / Ground.TILE;
                targetX += right * reach;
                targetY += south * reach;
            }
            Mouse mouse = Mouse.current;
            if (mouse != null)
            {
                float wheel = mouse.scroll.ReadValue().y;
                if (wheel > 0f) distance *= 0.9f;
                else if (wheel < 0f) distance *= 1.1f;
                if (mouse.middleButton.isPressed)
                {
                    Vector2 moved = mouse.delta.ReadValue();
                    float metresPerPixel = 2f * distance * Mathf.Tan(lens.fieldOfView * 0.5f * Mathf.Deg2Rad) / Mathf.Max(1, Screen.height);
                    targetX -= moved.x * metresPerPixel / Ground.TILE;
                    targetY += moved.y * metresPerPixel / Mathf.Sin(PITCH) / Ground.TILE;
                }
            }
        }

        void Place()
        {
            distance = Mathf.Clamp(distance, MIN_DISTANCE, MAX_DISTANCE);
            targetX = Mathf.Clamp(targetX, 0f, ground.map.width);
            targetY = Mathf.Clamp(targetY, 0f, ground.map.height);
            Vector3 target = ground.Place(targetX, targetY);
            Vector3 back = new Vector3(0f, Mathf.Sin(PITCH) * distance, -Mathf.Cos(PITCH) * distance);
            transform.SetPositionAndRotation(target + back, Quaternion.LookRotation(-back.normalized, Vector3.up));
        }
    }
}
