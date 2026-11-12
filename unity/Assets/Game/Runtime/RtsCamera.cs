using UnityEngine;
using UnityEngine.InputSystem;

namespace Rts.Game
{
    /// <summary>
    /// The view from above. The camera looks north and down at a fixed angle,
    /// at a point on the ground, from a distance; it never turns. Arrow keys
    /// move it, the wheel zooms, and holding the middle button drags the
    /// ground about. When nobody is playing, W A S D move it too; in a match
    /// those letters are orders.
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
        /// <summary>Whether W A S D move it as the arrows do.</summary>
        public bool lettersMove = true;
        /// <summary>Whether the pointer is over the field. Over a panel, the wheel and the middle button are the panel's.</summary>
        public bool pointerOnField = true;
        /// <summary>The devices it reads. Left empty, whichever keyboard and mouse were last used.</summary>
        public Keyboard keyboard;
        public Mouse mouse;

        Ground ground;
        Camera lens;

        public Camera Lens => lens;

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

        /// <summary>Brings the view closer (a number under 1) or takes it further off (over 1).</summary>
        public void Zoom(float factor)
        {
            distance *= factor;
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
            Keyboard keys = keyboard != null && keyboard.added ? keyboard : Keyboard.current;
            if (keys != null)
            {
                bool letters = lettersMove;
                float right = (keys.rightArrowKey.isPressed || (letters && keys.dKey.isPressed) ? 1f : 0f) - (keys.leftArrowKey.isPressed || (letters && keys.aKey.isPressed) ? 1f : 0f);
                float south = (keys.downArrowKey.isPressed || (letters && keys.sKey.isPressed) ? 1f : 0f) - (keys.upArrowKey.isPressed || (letters && keys.wKey.isPressed) ? 1f : 0f);
                // Moving by a share of what is on screen feels the same at any zoom.
                float reach = distance * 1.1f * dt / Ground.TILE;
                targetX += right * reach;
                targetY += south * reach;
            }
            Mouse pointer = mouse != null && mouse.added ? mouse : Mouse.current;
            if (pointer != null && pointerOnField)
            {
                float wheel = pointer.scroll.ReadValue().y;
                if (wheel > 0f) distance *= 0.9f;
                else if (wheel < 0f) distance *= 1.1f;
                if (pointer.middleButton.isPressed)
                {
                    Vector2 moved = pointer.delta.ReadValue();
                    float metresPerPixel = 2f * distance * Mathf.Tan(lens.fieldOfView * 0.5f * Mathf.Deg2Rad) / Mathf.Max(1, lens.pixelHeight);
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
