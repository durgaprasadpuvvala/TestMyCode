function load() {
    const table = document.getElementById("table"); // Explicitly get the table element
    
    fetch("/results")
    .then(res => {
        if (!res.ok) throw new Error("Network response was not ok");
        return res.json();
    })
    .then(data => {
        // Reset table header
        table.innerHTML = `
            <tr>
                <th>User</th>
                <th>Score</th>
            </tr>`;

        if (data.length === 0) {
            table.innerHTML += `<tr><td colspan="2">No results found</td></tr>`;
            return;
        }

        // Add rows for each student result
        data.forEach(r => {
            const row = table.insertRow(-1); // Appends at the end
            const userCell = row.insertCell(0);
            const scoreCell = row.insertCell(1);
            
            userCell.textContent = r.username || "Anonymous";
            scoreCell.textContent = r.score !== null ? r.score : "N/A";
            
            // Optional: Color code the score
            scoreCell.style.color = r.score >= 50 ? "green" : "red";
            scoreCell.style.fontWeight = "bold";
        });
    })
    .catch(err => {
        console.error("Fetch error:", err);
        alert("Could not load results. Check server logs.");
    });
}

// Automatically load results when the page opens
window.onload = load;