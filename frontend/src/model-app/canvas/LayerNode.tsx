import { memo } from "react";
import { Handle, Position, type NodeProps } from "reactflow";
import type { LayerNodeData } from "./layout";
import { useMenu } from "./menu";
import { useSelection } from "../editor/selection";

// Background swimlane column behind the object cards. The column's label is
// rendered separately by the sticky LayerHeaders overlay (pinned to the top
// of the canvas), so this node is just the tinted background (shown only when
// the layer is selected). Right-click opens the layer's add/delete menu.
function LayerNodeImpl({ data }: NodeProps<LayerNodeData>) {
  const { openMenu } = useMenu();
  const { onSelect } = useSelection();
  return (
    <div
      className="layer-node"
      id={`focus-node-${data.layerId}`}
      role="group"
      aria-label={`${data.label}, layer`}
      tabIndex={-1}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onSelect(data.layerId); // highlight the whole column
        openMenu(e.clientX, e.clientY, { kind: "node", id: data.layerId, type: "Layer" });
      }}
    >
      {/* Collapsed/hidden layer: edges from its hidden descendants land here
          (see layout.ts). Non-connectable — purely a routing anchor. */}
      {data.anchored && (
        <>
          <Handle id={`${data.layerId}-target-l`} type="target" position={Position.Left} className="attr-handle layer-handle" isConnectable={false} />
          <Handle id={`${data.layerId}-source-l`} type="source" position={Position.Left} className="attr-handle layer-handle" isConnectable={false} />
          <Handle id={`${data.layerId}-target-r`} type="target" position={Position.Right} className="attr-handle layer-handle" isConnectable={false} />
          <Handle id={`${data.layerId}-source-r`} type="source" position={Position.Right} className="attr-handle layer-handle" isConnectable={false} />
        </>
      )}
    </div>
  );
}

export default memo(LayerNodeImpl);
