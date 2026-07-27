function adminLogin(){

let user = document.getElementById("adminUser").value;
let pass = document.getElementById("adminPass").value;

if(user === "admin" && pass === "admin123")
{
    window.location.href="admin.html";
}
else
{
    alert("Invalid Admin Login");
}

}

function goBack(){
window.location.href="index.html";
}