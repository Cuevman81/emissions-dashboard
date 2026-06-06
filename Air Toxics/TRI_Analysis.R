# -------------------------------------------------------------------------
# AIR TOXICS RELEASE INVENTORY (TRI) ANALYSIS SCRIPT FOR MISSISSIPPI
# Focus: Air Emissions (Fugitive, Stack, and Total)
# -------------------------------------------------------------------------

# 1. Load Required Libraries
library(dplyr)    # For data manipulation
library(tidyr)    # For reshaping data
library(ggplot2)  # For data visualization
library(scales)   # For formatting plot axes (e.g., adding commas to numbers)
library(tidygeocoder) # For converting addresses to lat/long
library(leaflet)      # For interactive mapping

# Assuming TRI_2_23_2026 is already loaded in your environment from read_csv()

# -------------------------------------------------------------------------
# 2. Data Cleaning & Preparation
# -------------------------------------------------------------------------

# Subset the dataset to keep ONLY identifiers and AIR emission columns
tri_air_data <- TRI_2_23_2026 %>%
  select(
    REP_YEAR, FACILITY, ADDRESS, COUNTY, CITY, ZIP_CODE, NAICS, CHEM_NAME,
    FUG_AIR10, STACK_10, TOT_AIR10
  ) %>%
  # Replace NA values in emission columns with 0 (since NA usually means no release)
  mutate(
    FUG_AIR10 = replace_na(FUG_AIR10, 0),
    STACK_10  = replace_na(STACK_10, 0),
    TOT_AIR10 = replace_na(TOT_AIR10, 0)
  )

# -------------------------------------------------------------------------
# 3. Exploratory Data Analysis (Summary Tables)
# -------------------------------------------------------------------------

# A. Yearly Trend Summary
yearly_emissions <- tri_air_data %>%
  group_by(REP_YEAR) %>%
  summarise(
    Total_Fugitive = sum(FUG_AIR10, na.rm = TRUE),
    Total_Stack    = sum(STACK_10, na.rm = TRUE),
    Total_Air      = sum(TOT_AIR10, na.rm = TRUE),
    Active_Facilities = n_distinct(FACILITY) # Count of reporting facilities per year
  ) %>%
  arrange(REP_YEAR)

# B. Top 10 Facilities by Total Air Emissions (All Time)
top_facilities <- tri_air_data %>%
  group_by(FACILITY, CITY, COUNTY) %>%
  summarise(Total_Air_Emissions = sum(TOT_AIR10, na.rm = TRUE), .groups = "drop") %>%
  arrange(desc(Total_Air_Emissions)) %>%
  slice_head(n = 10)

# C. Top 10 Chemicals Released to Air (All Time)
top_chemicals <- tri_air_data %>%
  group_by(CHEM_NAME) %>%
  summarise(Total_Air_Emissions = sum(TOT_AIR10, na.rm = TRUE), .groups = "drop") %>%
  arrange(desc(Total_Air_Emissions)) %>%
  slice_head(n = 10)

# D. County Summary (Which counties have the highest air releases?)
county_emissions <- tri_air_data %>%
  group_by(COUNTY) %>%
  summarise(Total_Air_Emissions = sum(TOT_AIR10, na.rm = TRUE), .groups = "drop") %>%
  arrange(desc(Total_Air_Emissions))

# View the summaries in RStudio
View(yearly_emissions)
View(top_facilities)
View(top_chemicals)

# E. Map Data Preparation & Geocoding (WITH CACHING & CHEMICAL COLORS)
# 1. First, find the "Primary Chemical" (highest volume) for each facility
primary_chemicals <- tri_air_data %>%
  group_by(FACILITY, ADDRESS, CITY, ZIP_CODE, CHEM_NAME) %>%
  summarise(Chem_Emissions = sum(TOT_AIR10, na.rm = TRUE), .groups = "drop") %>%
  arrange(desc(Chem_Emissions)) %>%
  group_by(FACILITY, ADDRESS, CITY, ZIP_CODE) %>%
  slice_head(n = 1) %>%
  select(FACILITY, ADDRESS, CITY, ZIP_CODE, Primary_Chemical = CHEM_NAME)

# 2. Group by facility to get unique locations, total emissions, and a list of all chemicals
facility_summary <- tri_air_data %>%
  group_by(FACILITY, ADDRESS, CITY, ZIP_CODE) %>%
  summarise(
    Total_Air_Emissions = sum(TOT_AIR10, na.rm = TRUE),
    Chemicals_Emitted = paste(unique(CHEM_NAME), collapse = ", "),
    .groups = "drop"
  ) %>%
  # Merge in the Primary Chemical we calculated above
  left_join(primary_chemicals, by = c("FACILITY", "ADDRESS", "CITY", "ZIP_CODE")) %>%
  mutate(Full_Address = paste0(ADDRESS, ", ", CITY, ", MS ", ZIP_CODE))

# --- CACHING LOGIC ---
cache_file <- "geocoded_addresses_cache.csv"

unique_addresses <- facility_summary %>%
  select(Full_Address) %>%
  distinct()

if (file.exists(cache_file)) {
  message("Found cached coordinates. Checking for any new addresses...")
  cached_coords <- read.csv(cache_file, stringsAsFactors = FALSE)
  
  addresses_to_geocode <- unique_addresses %>%
    filter(!Full_Address %in% cached_coords$Full_Address)
  
  if (nrow(addresses_to_geocode) > 0) {
    message(paste("Geocoding", nrow(addresses_to_geocode), "new addresses..."))
    new_coords <- addresses_to_geocode %>%
      geocode(address = Full_Address, method = 'osm', lat = latitude, long = longitude)
    
    cached_coords <- bind_rows(cached_coords, new_coords)
    write.csv(cached_coords, cache_file, row.names = FALSE)
  } else {
    message("No new addresses! Loading map instantly using cached data.")
  }
} else {
  message("No cache found. Geocoding all addresses for the first time... (Takes a few mins)")
  cached_coords <- unique_addresses %>%
    geocode(address = Full_Address, method = 'osm', lat = latitude, long = longitude)
  
  write.csv(cached_coords, cache_file, row.names = FALSE)
}

# 3. Join coordinates and create the Map Color Category
# Grab the top 8 chemicals statewide (calculated in Section 3C) for a clean map legend
top_8_chems <- top_chemicals$CHEM_NAME[1:8]

facility_map_data <- facility_summary %>%
  left_join(cached_coords, by = "Full_Address") %>%
  filter(!is.na(latitude) & !is.na(longitude)) %>%
  # Assign the category: If it's in the top 8, keep the name, otherwise label as "Other"
  mutate(
    Map_Category = ifelse(Primary_Chemical %in% top_8_chems, 
                          Primary_Chemical, 
                          "Other")
  )

View(facility_map_data)

# 4. Create Yearly Map Data (for the map toggle)
# Calculate the primary chemical for each specific year
yearly_primary <- tri_air_data %>%
  group_by(REP_YEAR, FACILITY, ADDRESS, CITY, ZIP_CODE, CHEM_NAME) %>%
  summarise(Chem_Emissions = sum(TOT_AIR10, na.rm = TRUE), .groups = "drop") %>%
  arrange(desc(Chem_Emissions)) %>%
  group_by(REP_YEAR, FACILITY, ADDRESS, CITY, ZIP_CODE) %>%
  slice_head(n = 1) %>%
  select(REP_YEAR, FACILITY, ADDRESS, CITY, ZIP_CODE, Primary_Chemical = CHEM_NAME)

# Summarize total emissions by year and join coordinates
yearly_map_data <- tri_air_data %>%
  group_by(REP_YEAR, FACILITY, ADDRESS, CITY, ZIP_CODE) %>%
  summarise(
    Total_Air_Emissions = sum(TOT_AIR10, na.rm = TRUE),
    Chemicals_Emitted = paste(unique(CHEM_NAME), collapse = ", "),
    .groups = "drop"
  ) %>%
  left_join(yearly_primary, by = c("REP_YEAR", "FACILITY", "ADDRESS", "CITY", "ZIP_CODE")) %>%
  mutate(Full_Address = paste0(ADDRESS, ", ", CITY, ", MS ", ZIP_CODE)) %>%
  # Join the SAME cached coordinates we already looked up
  left_join(cached_coords, by = "Full_Address") %>%
  filter(!is.na(latitude) & !is.na(longitude)) %>%
  # Assign the color category just like we did for the all-time map
  mutate(
    Map_Category = ifelse(Primary_Chemical %in% top_8_chems, Primary_Chemical, "Other")
  )

# -------------------------------------------------------------------------
# 4. Data Visualization (Graphs)
# -------------------------------------------------------------------------

# Plot 1: Trend of Total Air Emissions Over Time
p1 <- ggplot(yearly_emissions, aes(x = REP_YEAR, y = Total_Air)) +
  geom_line(color = "steelblue", linewidth = 1.2) +
  geom_point(color = "darkred", size = 3) +
  scale_y_continuous(labels = comma) + # Adds commas to large numbers
  scale_x_continuous(breaks = unique(yearly_emissions$REP_YEAR)) +
  theme_minimal() +
  labs(
    title = "Total Air Toxics Emissions by Year in Mississippi",
    subtitle = "Aggregated Total Air Emissions (lbs)",
    x = "Reporting Year",
    y = "Total Air Emissions (lbs)"
  )

# Plot 2: Stack vs. Fugitive Emissions Over Time (Stacked Bar Chart)
# First, reshape the data for stacked plotting
yearly_long <- yearly_emissions %>%
  select(REP_YEAR, Total_Fugitive, Total_Stack) %>%
  pivot_longer(cols = c(Total_Fugitive, Total_Stack), 
               names_to = "Emission_Type", 
               values_to = "Pounds")

p2 <- ggplot(yearly_long, aes(x = as.factor(REP_YEAR), y = Pounds, fill = Emission_Type)) +
  geom_bar(stat = "identity") +
  scale_y_continuous(labels = comma) +
  scale_fill_manual(values = c("Total_Fugitive" = "#E69F00", "Total_Stack" = "#56B4E9"),
                    labels = c("Fugitive Emissions", "Stack Emissions")) +
  theme_minimal() +
  labs(
    title = "Fugitive vs. Stack Air Emissions by Year",
    x = "Reporting Year",
    y = "Emissions (lbs)",
    fill = "Emission Type"
  )

# Plot 3: Top 10 Facilities (Bar Chart)
p3 <- ggplot(top_facilities, aes(x = reorder(FACILITY, Total_Air_Emissions), y = Total_Air_Emissions)) +
  geom_col(fill = "darkred") +
  coord_flip() + # Flips to horizontal bars for readable facility names
  scale_y_continuous(labels = comma) +
  theme_minimal() +
  labs(
    title = "Top 10 Facilities by Total Air Emissions",
    x = "Facility Name",
    y = "Total Air Emissions (lbs)"
  )

# Plot 4: Top 10 Chemicals (Bar Chart)
p4 <- ggplot(top_chemicals, aes(x = reorder(CHEM_NAME, Total_Air_Emissions), y = Total_Air_Emissions)) +
  geom_col(fill = "forestgreen") +
  coord_flip() +
  scale_y_continuous(labels = comma) +
  theme_minimal() +
  labs(
    title = "Top 10 Chemicals Released to Air",
    x = "Chemical Name",
    y = "Total Air Emissions (lbs)"
  )

# Plot 5: Interactive Map of Facilities with Year Toggle
# Safely define the color palette using our specific top 8 categories + "Other"
chem_palette <- colorFactor(palette = "Set1", domain = c(top_8_chems, "Other"))

# Step A: Base map with the "All-Time Total" layer
facility_map <- leaflet() %>%
  addTiles() %>%  
  addCircleMarkers(
    data = facility_map_data,
    ~longitude, ~latitude,
    radius = ~ifelse(Total_Air_Emissions > 0, log10(Total_Air_Emissions + 1) * 4, 3), 
    color = ~chem_palette(Map_Category),
    stroke = FALSE,
    fillOpacity = 0.8,
    group = "All-Time Total", # Assign this data to a layer group
    popup = ~paste0(
      "<strong>Facility: </strong>", FACILITY, "<br/>",
      "<strong>Timeframe: </strong>All-Time Total<br/>",
      "<strong>Total Air Emissions: </strong>", comma(Total_Air_Emissions), " lbs<br/>",
      "<strong>Primary Chemical: </strong>", Primary_Chemical, "<br/>",
      "<strong>All Chemicals Emitted: </strong>", Chemicals_Emitted
    )
  )

# Step B: Loop through each unique year and add a distinct layer for it
map_years <- sort(unique(yearly_map_data$REP_YEAR), decreasing = TRUE)

for (yr in map_years) {
  # Filter data for just this specific year in the loop
  yr_data <- yearly_map_data %>% filter(REP_YEAR == yr)
  
  facility_map <- facility_map %>%
    addCircleMarkers(
      data = yr_data,
      ~longitude, ~latitude,
      radius = ~ifelse(Total_Air_Emissions > 0, log10(Total_Air_Emissions + 1) * 4, 3), 
      color = ~chem_palette(Map_Category),
      stroke = FALSE,
      fillOpacity = 0.8,
      group = as.character(yr), # Assign to the year's layer group
      popup = ~paste0(
        "<strong>Facility: </strong>", FACILITY, "<br/>",
        "<strong>Year: </strong>", REP_YEAR, "<br/>",
        "<strong>Total Air Emissions: </strong>", comma(Total_Air_Emissions), " lbs<br/>",
        "<strong>Primary Chemical: </strong>", Primary_Chemical, "<br/>",
        "<strong>All Chemicals Emitted: </strong>", Chemicals_Emitted
      )
    )
}

# Step C: Add the layer toggle control, legend, and title
facility_map <- facility_map %>%
  addLayersControl(
    # baseGroups acts like a radio button (only one timeline can be selected at once)
    baseGroups = c("All-Time Total", as.character(map_years)),
    options = layersControlOptions(collapsed = FALSE),
    position = "topleft"
  ) %>%
  addLegend("bottomleft", pal = chem_palette, values = c(top_8_chems, "Other"),
            title = "Primary Chemical Emitted", opacity = 1) %>%
  addControl(html = "<strong>Mississippi TRI Air Emissions</strong><br/>Select a year on the left.<br/>Click circles for details.", 
             position = "topright")

# Print the interactive map to the RStudio Viewer
print(facility_map)

# Print Plots to the Viewer
print(p1)
print(p2)
print(p3)
print(p4)

# -------------------------------------------------------------------------
# 5. Exporting Results (Optional)
# -------------------------------------------------------------------------
# Un-comment the lines below to save your summary tables to CSV files
# write_csv(yearly_emissions, "Air_Emissions_by_Year.csv")
# write_csv(top_facilities, "Top_Facilities_Air_Emissions.csv")
# write_csv(top_chemicals, "Top_Chemicals_Air_Emissions.csv")