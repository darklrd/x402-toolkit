interface Tool {
  id: 'weather' | 'price';
  emoji: string;
  label: string;
  inputLabel: string;
  defaultValue: string;
}

const tools: Tool[] = [
  { id: 'weather', emoji: '🌤', label: 'Weather', inputLabel: 'City', defaultValue: 'London' },
  { id: 'price', emoji: '💰', label: 'Crypto Price', inputLabel: 'Symbol', defaultValue: 'BTC' },
];

interface ToolPickerProps {
  selected: 'weather' | 'price';
  onSelect: (tool: 'weather' | 'price') => void;
  inputValue: string;
  onInputChange: (value: string) => void;
}

export default function ToolPicker({ selected, onSelect, inputValue, onInputChange }: ToolPickerProps) {
  const activeTool = tools.find((t) => t.id === selected) ?? tools[0];

  return (
    <div className="space-y-4">
      <div className="flex gap-3">
        {tools.map((tool) => (
          <button
            key={tool.id}
            onClick={() => onSelect(tool.id)}
            className={`flex-1 rounded-lg border-2 p-4 text-left transition ${
              selected === tool.id
                ? 'border-accent-500 bg-accent-950/50'
                : 'border-slate-700 bg-slate-900 hover:border-slate-600'
            }`}
          >
            <span className="text-2xl">{tool.emoji}</span>
            <p className="mt-1 text-sm font-medium text-white">{tool.label}</p>
          </button>
        ))}
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-400">
          {activeTool.inputLabel}
        </label>
        <input
          type="text"
          value={inputValue}
          onChange={(e) => onInputChange(e.target.value)}
          className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-accent-500 focus:outline-none"
          placeholder={activeTool.defaultValue}
        />
      </div>
    </div>
  );
}
