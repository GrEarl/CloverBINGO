import { Route, Routes } from "react-router-dom";

import AdminPage from "./routes/AdminPage";
import DisplayPage from "./routes/DisplayPage";
import HomePage from "./routes/HomePage";
import ModPage from "./routes/ModPage";
import ParticipantPage from "./routes/ParticipantPage";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/s/:code" element={<ParticipantPage />} />
      <Route path="/s/:code/display/:screen" element={<DisplayPage />} />
      <Route path="/admin/:code" element={<AdminPage />} />
      <Route path="/mod/:code" element={<ModPage />} />
    </Routes>
  );
}
