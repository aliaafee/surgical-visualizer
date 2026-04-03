import { useState } from "react";

function App() {
    const [count, setCount] = useState(0);

    return (
        <div className="bg-red-500">
            Surgical Visualizer <div>count: {count}</div>{" "}
            <button onClick={() => setCount(count + 1)}>Increment</button>
        </div>
    );
}

export default App;
