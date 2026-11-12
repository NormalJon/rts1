using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.RenderGraphModule;
using UnityEngine.Rendering.Universal;

namespace Rts.Game
{
    /// <summary>
    /// Draws the fog of war over the picture (Shaders/Fog.shader), once the
    /// ground and everything standing on it has been drawn and before the
    /// see-through things that go on top: selection rings, order markers and
    /// the like, which must stay bright.
    ///
    /// It is handed to the renderer each frame for the match camera only, so
    /// nothing has to be set up in the render settings for it.
    /// </summary>
    public sealed class FogPass : ScriptableRenderPass
    {
        static readonly int BLIT_SCALE_BIAS = Shader.PropertyToID("_BlitScaleBias");

        sealed class PassData
        {
            public Material material;
        }

        readonly Material material;
        readonly Camera lens;
        readonly MaterialPropertyBlock block = new MaterialPropertyBlock();
        Sight sight;
        bool listening;

        public FogPass(Material material, Camera lens)
        {
            this.material = material;
            this.lens = lens;
            renderPassEvent = RenderPassEvent.BeforeRenderingTransparents;
            // It needs to know how far away each dot of the picture is, to work out where on the map it lies.
            ConfigureInput(ScriptableRenderPassInput.Depth);
        }

        /// <summary>Starts drawing the fog that this sight keeps.</summary>
        public void Show(Sight sight)
        {
            this.sight = sight;
            if (listening) return;
            listening = true;
            RenderPipelineManager.beginCameraRendering += Before;
        }

        public void Stop()
        {
            sight = null;
            if (!listening) return;
            listening = false;
            RenderPipelineManager.beginCameraRendering -= Before;
        }

        void Before(ScriptableRenderContext context, Camera camera)
        {
            if (camera != lens || material == null || sight == null || !sight.AnyFog) return;
            UniversalAdditionalCameraData data = camera.GetUniversalAdditionalCameraData();
            if (data == null || data.scriptableRenderer == null) return;
            data.scriptableRenderer.EnqueuePass(this);
        }

        public override void RecordRenderGraph(RenderGraph renderGraph, ContextContainer frameData)
        {
            UniversalResourceData resources = frameData.Get<UniversalResourceData>();
            using (IRasterRenderGraphBuilder builder = renderGraph.AddRasterRenderPass("Fog of war", out PassData data))
            {
                data.material = material;
                if (resources.cameraDepthTexture.IsValid()) builder.UseTexture(resources.cameraDepthTexture);
                builder.SetRenderAttachment(resources.activeColorTexture, 0, AccessFlags.Write);
                MaterialPropertyBlock properties = block;
                builder.SetRenderFunc((PassData pass, RasterGraphContext context) =>
                {
                    properties.Clear();
                    properties.SetVector(BLIT_SCALE_BIAS, new Vector4(1f, 1f, 0f, 0f));
                    // One triangle that covers the screen.
                    context.cmd.DrawProcedural(Matrix4x4.identity, pass.material, 0, MeshTopology.Triangles, 3, 1, properties);
                });
            }
        }
    }
}
