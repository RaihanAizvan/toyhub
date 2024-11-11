// to handle the hower case of header
document.addEventListener('DOMContentLoaded', function () {
    const button = document.querySelector('.relative .inline-flex');
    const dropdown = document.querySelector('.relative .hidden');

    button.addEventListener('mouseover', function () {
        dropdown.classList.remove('hidden');
    });

    button.addEventListener('mouseout', function () {
        dropdown.classList.add('hidden');
    });
});

//otp auto move to next field
function moveOnMax(current, nextFieldId) {
    if (current.value.length >= current.maxLength) {
        const nextField = document.getElementById(nextFieldId);
        if (nextField) {
            nextField.focus();
        }   
    }
}

// Get the spinner container element
const spinnerContainer = document.getElementById('spinnerContainer');

// Configure the spinner options
const opts = {
    lines: 12, // Number of lines in the spinner
    length: 20, // Length of each line
    width: 8, // Thickness of the lines
    radius: 30, // Radius of the spinner
    scale: 1, // Scale size
    corners: 1, // Roundness of the corners
    color: '#00A845', // Color of the spinner
    fadeColor: 'transparent', // Fade color
    speed: 1, // Rounds per second
    rotate: 0, // Rotation offset
    animation: 'spinner-line-fade-quick', // Animation type
    direction: 1, // Clockwise rotation
    zIndex: 2e9, // Z-index
    position: 'absolute' // Positioning
};

// Initialize the spinner (but don't spin it yet)
const spinner = new Spinner(opts);

// Function to show the spinner
function showSpinner() {
    spinner.spin(spinnerContainer); // Start spinning
    spinnerContainer.classList.remove('hidden'); // Show the container
}

// Function to hide the spinner
function hideSpinner() {
    spinner.stop(); // Stop the spinner
    spinnerContainer.classList.add('hidden'); // Hide the container
}
